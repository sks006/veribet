import { Match } from '../types';

export async function fetchMatches(): Promise<Match[]> {
  // Simple read client-side helper returning initial data
  return [
    { id: 'LIV-MCI-2026', homeTeam: 'Liverpool', awayTeam: 'Man City', status: 'LIVE', homeScore: 1, awayScore: 1, totalStats: 2, kickoffTime: Date.now() - 1800000, sport: 'Football' },
    { id: 'CHE-ARS-2026', homeTeam: 'Chelsea', awayTeam: 'Arsenal', status: 'SCHEDULED', homeScore: 0, awayScore: 0, totalStats: 0, kickoffTime: Date.now() + 600000, sport: 'Football' },
    { id: 'LAL-BOS-2026', homeTeam: 'LA Lakers', awayTeam: 'Boston Celtics', status: 'LIVE', homeScore: 92, awayScore: 95, totalStats: 187, kickoffTime: Date.now() - 3600000, sport: 'Basketball' }
  ];
}
