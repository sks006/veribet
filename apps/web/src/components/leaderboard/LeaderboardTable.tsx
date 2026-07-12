import React from 'react';
import { Trophy, Star, Shield, Medal } from 'lucide-react';

interface LeaderboardEntry {
  rank: number;
  wallet: string;
  points: number;
  winRate: number;
  streak: number;
  tier: 'Gold' | 'Silver' | 'Bronze' | 'Starter';
}

const mockLeaderboard: LeaderboardEntry[] = [
  { rank: 1, wallet: '8x2P...aK9q', points: 2850, winRate: 82.4, streak: 8, tier: 'Gold' },
  { rank: 2, wallet: 'HjT4...9sWp', points: 2410, winRate: 74.8, streak: 4, tier: 'Gold' },
  { rank: 3, wallet: '4mK3...Lo8d', points: 1980, winRate: 69.1, streak: 0, tier: 'Silver' },
  { rank: 4, wallet: 'J8u7...Pr2m', points: 1540, winRate: 65.5, streak: 2, tier: 'Silver' },
  { rank: 5, wallet: '5yTx...9x2d', points: 1220, winRate: 60.2, streak: 1, tier: 'Bronze' },
  { rank: 6, wallet: 'Gq3p...Lt8w', points: 980, winRate: 58.7, streak: 0, tier: 'Bronze' },
  { rank: 7, wallet: '2zKf...4hNq', points: 760, winRate: 54.3, streak: 1, tier: 'Starter' }
];

export function LeaderboardTable() {
  const getRankIcon = (rank: number) => {
    if (rank === 1) return <Trophy size={16} className="text-yellow-400" />;
    if (rank === 2) return <Medal size={16} className="text-slate-300" />;
    if (rank === 3) return <Medal size={16} className="text-amber-600" />;
    return <span className="rank-number">{rank}</span>;
  };

  const getTierBadge = (tier: string) => {
    switch (tier) {
      case 'Gold':
        return <span className="tier-badge gold"><Star size={10} className="inline mr-1" /> GOLD</span>;
      case 'Silver':
        return <span className="tier-badge silver"><Shield size={10} className="inline mr-1" /> SILVER</span>;
      case 'Bronze':
        return <span className="tier-badge bronze"><Shield size={10} className="inline mr-1" /> BRONZE</span>;
      default:
        return <span className="tier-badge starter">STARTER</span>;
    }
  };

  return (
    <div className="leaderboard-container">
      <div className="leaderboard-header">
        <h3 className="leaderboard-title">Top Predictors</h3>
        <span className="leaderboard-subtitle">Updated live from contract positions</span>
      </div>

      <div className="table-wrapper">
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th className="align-center">Rank</th>
              <th>Predictor Wallet</th>
              <th>Rank Tier</th>
              <th className="align-right">Accumulated Points</th>
              <th className="align-right">Win Rate</th>
              <th className="align-right">Active Streak</th>
            </tr>
          </thead>
          <tbody>
            {mockLeaderboard.map((entry) => (
              <tr key={entry.rank} className="table-row">
                <td className="align-center rank-cell">{getRankIcon(entry.rank)}</td>
                <td className="wallet-cell">{entry.wallet}</td>
                <td>{getTierBadge(entry.tier)}</td>
                <td className="align-right bold points-val">{entry.points} pts</td>
                <td className="align-right text-emerald-600 bold">{entry.winRate}%</td>
                <td className="align-right text-orange-600 bold">
                  {entry.streak > 0 ? `${entry.streak} W` : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style jsx>{`
        .leaderboard-container {
          background: #ffffff;
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 20px;
          padding: 1.5rem;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          width: 100%;
          max-width: 100%;
          overflow: hidden;
        }

        .leaderboard-header {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }

        .leaderboard-title {
          font-size: 1.15rem;
          font-weight: 700;
          color: #0f172a;
          letter-spacing: -0.02em;
        }

        .leaderboard-subtitle {
          font-size: 0.75rem;
          color: #64748b;
        }

        .table-wrapper {
          width: 100%;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }

        .leaderboard-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }

        .leaderboard-table th {
          padding: 0.75rem 1rem;
          font-size: 0.7rem;
          font-weight: 600;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 1px solid rgba(15, 23, 42, 0.08);
        }

        .leaderboard-table td {
          padding: 1rem;
          font-size: 0.85rem;
          color: #334155;
          border-bottom: 1px solid rgba(15, 23, 42, 0.04);
        }

        .table-row {
          transition: background 0.2s ease;
        }

        .table-row:hover {
          background: rgba(0, 0, 0, 0.01);
        }

        .align-center {
          text-align: center;
        }

        .align-right {
          text-align: right;
        }

        .bold {
          font-weight: 700;
        }

        .rank-cell {
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100%;
          min-height: 20px;
        }

        .rank-number {
          font-size: 0.8rem;
          font-weight: 700;
          color: #64748b;
        }

        .wallet-cell {
          font-family: monospace;
          color: #0f172a;
          font-weight: 600;
        }

        .points-val {
          color: #09090b;
        }

        .tier-badge {
          font-size: 0.65rem;
          font-weight: 700;
          padding: 0.15rem 0.45rem;
          border-radius: 6px;
        }

        .tier-badge.gold {
          background: rgba(234, 179, 8, 0.1);
          color: #854d0e;
          border: 1px solid rgba(234, 179, 8, 0.2);
        }

        .tier-badge.silver {
          background: rgba(148, 163, 184, 0.1);
          color: #475569;
          border: 1px solid rgba(148, 163, 184, 0.2);
        }

        .tier-badge.bronze {
          background: rgba(217, 119, 6, 0.1);
          color: #9a3412;
          border: 1px solid rgba(217, 119, 6, 0.2);
        }

        .tier-badge.starter {
          background: rgba(100, 116, 139, 0.1);
          color: #475569;
          border: 1px solid rgba(100, 116, 139, 0.2);
        }
      `}</style>
    </div>
  );
}
