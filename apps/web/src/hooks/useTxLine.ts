import { useEffect, useState } from 'react';
import { Match } from '../types';

export function useTxLine() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('[useTxLine] Connecting to /api/stream multiplexer...');
    const eventSource = new EventSource('/api/stream');

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        const updatedMatch: Match = {
          id: data.matchId,
          homeTeam: getHomeTeam(data.matchId),
          awayTeam: getAwayTeam(data.matchId),
          status: data.status,
          homeScore: data.homeScore,
          awayScore: data.awayScore,
          totalStats: data.totalStats,
          kickoffTime: Date.now(),
          sport: data.matchId.startsWith('LAL') ? 'Basketball' : 'Football'
        };

        setMatches((prev) => {
          const index = prev.findIndex(m => m.id === updatedMatch.id);
          if (index > -1) {
            const next = [...prev];
            next[index] = { ...prev[index], ...updatedMatch };
            return next;
          }
          return [...prev, updatedMatch];
        });
        setLoading(false);
      } catch (e) {
        console.error('[useTxLine] Error parsing SSE message:', e);
      }
    };

    eventSource.onerror = (err) => {
      console.error('[useTxLine] SSE Connection error:', err);
    };

    return () => {
      eventSource.close();
    };
  }, []);

  return { matches, loading };
}

function getHomeTeam(id: string): string {
  if (id.startsWith('LIV')) return 'Liverpool';
  if (id.startsWith('CHE')) return 'Chelsea';
  if (id.startsWith('LAL')) return 'LA Lakers';
  return id.split('-')[0] || 'Home Team';
}

function getAwayTeam(id: string): string {
  if (id.startsWith('LIV')) return 'Man City';
  if (id.startsWith('CHE')) return 'Arsenal';
  if (id.startsWith('LAL')) return 'Boston Celtics';
  return id.split('-')[1] || 'Away Team';
}
