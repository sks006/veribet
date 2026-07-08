import { useEffect, useState, useRef } from 'react';
import { Match } from '../types';

export function useTxLine() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let eventSource: EventSource | null = null;

    const connect = () => {
      console.log('[useTxLine] Connecting to /api/stream multiplexer...');
      setConnectionStatus('connecting');
      eventSource = new EventSource('/api/stream');

      eventSource.onopen = () => {
        console.log('[useTxLine] SSE connected.');
        setConnectionStatus('connected');
        setLoading(false);
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.status === 'ORACLE_DISCONNECTED') {
            setConnectionStatus('disconnected');
            return;
          }
          
          const updatedMatch: Match = {
            id: data.matchId,
            homeTeam: data.homeTeam || getHomeTeam(data.matchId),
            awayTeam: data.awayTeam || getAwayTeam(data.matchId),
            status: data.status,
            homeScore: data.homeScore,
            awayScore: data.awayScore,
            totalStats: data.totalStats,
            kickoffTime: data.kickoffTime || Date.now(),
            sport: data.sport || (data.matchId.endsWith('WC26') ? 'World Cup 🏆' : data.matchId.startsWith('LAL') ? 'Basketball' : 'Football')
          };

          setMatches((prev) => {
            const index = prev.findIndex(m => m.id === updatedMatch.id);
            if (index > -1) {
              const existing = prev[index];
              if (
                existing.status === updatedMatch.status &&
                existing.homeScore === updatedMatch.homeScore &&
                existing.awayScore === updatedMatch.awayScore &&
                existing.totalStats === updatedMatch.totalStats
              ) {
                return prev;
              }
              const next = [...prev];
              next[index] = { ...prev[index], ...updatedMatch };
              return next;
            }
            return [...prev, updatedMatch];
          });
        } catch (e) {
          console.error('[useTxLine] Error parsing SSE message:', e);
        }
      };

      eventSource.onerror = (err) => {
        console.error('[useTxLine] SSE Connection error, attempting reconnection in 5s...', err);
        setConnectionStatus('disconnected');
        if (eventSource) {
          eventSource.close();
        }
        reconnectTimeoutRef.current = setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      if (eventSource) {
        eventSource.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  return { matches, loading, connectionStatus };
}

function getHomeTeam(id: string): string {
  const part = id.split('-')[0];
  if (part === 'LIV') return 'Liverpool';
  if (part === 'CHE') return 'Chelsea';
  if (part === 'LAL') return 'LA Lakers';
  if (part === 'ARG') return 'Argentina 🇦🇷';
  if (part === 'BRA') return 'Brazil 🇧🇷';
  if (part === 'USA') return 'USA 🇺🇸';
  return part || 'Home Team';
}

function getAwayTeam(id: string): string {
  const part = id.split('-')[1];
  if (part === 'MCI') return 'Man City';
  if (part === 'ARS') return 'Arsenal';
  if (part === 'BOS') return 'Boston Celtics';
  if (part === 'FRA') return 'France 🇫🇷';
  if (part === 'GER') return 'Germany 🇩🇪';
  if (part === 'MEX') return 'Mexico 🇲🇽';
  return part || 'Away Team';
}
