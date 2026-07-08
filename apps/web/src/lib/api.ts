import { Match } from '../types';

export async function fetchMatches(): Promise<Match[]> {
  // Simple read client-side helper returning initial data
  return [
    { id: 'ARG-FRA-WC26', homeTeam: 'Argentina 🇦🇷', awayTeam: 'France 🇫🇷', status: 'LIVE', homeScore: 2, awayScore: 2, totalStats: 4, kickoffTime: Date.now() - 2700000, sport: 'World Cup 🏆' },
    { id: 'BRA-GER-WC26', homeTeam: 'Brazil 🇧🇷', awayTeam: 'Germany 🇩🇪', status: 'LIVE', homeScore: 1, awayScore: 0, totalStats: 1, kickoffTime: Date.now() - 900000, sport: 'World Cup 🏆' },
    { id: 'USA-MEX-WC26', homeTeam: 'USA 🇺🇸', awayTeam: 'Mexico 🇲🇽', status: 'SCHEDULED', homeScore: 0, awayScore: 0, totalStats: 0, kickoffTime: Date.now() + 1800000, sport: 'World Cup 🏆' },
    { id: 'LIV-MCI-2026', homeTeam: 'Liverpool', awayTeam: 'Man City', status: 'LIVE', homeScore: 1, awayScore: 1, totalStats: 2, kickoffTime: Date.now() - 1800000, sport: 'Football' },
    { id: 'CHE-ARS-2026', homeTeam: 'Chelsea', awayTeam: 'Arsenal', status: 'SCHEDULED', homeScore: 0, awayScore: 0, totalStats: 0, kickoffTime: Date.now() + 600000, sport: 'Football' },
    { id: 'LAL-BOS-2026', homeTeam: 'LA Lakers', awayTeam: 'Boston Celtics', status: 'LIVE', homeScore: 92, awayScore: 95, totalStats: 187, kickoffTime: Date.now() - 3600000, sport: 'Basketball' }
  ];
}
