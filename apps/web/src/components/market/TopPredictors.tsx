import React from 'react';
import { Trophy, Award, Medal } from 'lucide-react';

interface Bet {
  id: string;
  type: 'standard' | 'prop';
  marketTitle: string;
  bettor: string;
  amount: number;
  side: 'YES' | 'NO';
  timestamp: number;
}

interface TopPredictorsProps {
  bets: Bet[];
  loading: boolean;
}

export function TopPredictors({ bets, loading }: TopPredictorsProps) {
  // Aggregate total volume per bettor address
  const aggregation: Record<string, { address: string; totalVolume: number; count: number }> = {};
  bets.forEach((bet) => {
    if (!aggregation[bet.bettor]) {
      aggregation[bet.bettor] = { address: bet.bettor, totalVolume: 0, count: 0 };
    }
    aggregation[bet.bettor].totalVolume += bet.amount;
    aggregation[bet.bettor].count += 1;
  });

  const sortedPredictors = Object.values(aggregation)
    .sort((a, b) => b.totalVolume - a.totalVolume)
    .slice(0, 3); // top 3

  const getRankIcon = (index: number) => {
    switch (index) {
      case 0:
        return <Trophy className="rank-icon-svg text-amber" />;
      case 1:
        return <Award className="rank-icon-svg text-silver" />;
      case 2:
        return <Medal className="rank-icon-svg text-bronze" />;
      default:
        return null;
    }
  };

  return (
    <div className="card-container shadow-premium">
      <div className="card-header-bar">
        <h3 className="card-title">
          <Trophy className="trophy-pulse" />
          Top Predictors
        </h3>
        <p className="card-subtitle">Ranked by aggregate volume in USDC</p>
      </div>

      {loading && bets.length === 0 ? (
        <div className="loading-state">
          <div className="spinner-mini" />
        </div>
      ) : sortedPredictors.length === 0 ? (
        <div className="empty-state">
          No positions recorded yet.
        </div>
      ) : (
        <div className="predictors-list">
          {sortedPredictors.map((predictor, index) => (
            <div key={predictor.address} className="predictor-item">
              <div className="predictor-left">
                <div className="rank-badge">
                  {getRankIcon(index)}
                </div>
                <div className="predictor-info">
                  <span className="address-mono">
                    {predictor.address.slice(0, 6)}...{predictor.address.slice(-6)}
                  </span>
                  <span className="count-label">
                    {predictor.count} {predictor.count === 1 ? 'position' : 'positions'} placed
                  </span>
                </div>
              </div>

              <div className="predictor-right">
                <span className="amount-label text-gold">
                  {predictor.totalVolume.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  <span className="currency-label">USDC</span>
                </span>
                <span className="stake-label">
                  Total Stake
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <style jsx>{`
        .card-container {
          background: #ffffff;
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 20px;
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          font-family: ui-sans-serif, system-ui, sans-serif;
        }
        .shadow-premium {
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
        }
        .card-header-bar {
          border-bottom: 1px solid rgba(15, 23, 42, 0.06);
          padding-bottom: 1rem;
        }
        .card-title {
          font-size: 1.05rem;
          font-weight: 700;
          color: #0f172a;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin: 0;
        }
        .trophy-pulse {
          color: #f59e0b;
          width: 1.25rem;
          height: 1.25rem;
        }
        .card-subtitle {
          font-size: 0.75rem;
          color: #64748b;
          margin: 0.25rem 0 0 0;
        }
        .loading-state {
          display: flex;
          justify-content: center;
          padding: 2rem 0;
        }
        .spinner-mini {
          width: 1.5rem;
          height: 1.5rem;
          border: 2px solid rgba(15, 23, 42, 0.1);
          border-top-color: #0f172a;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        .empty-state {
          text-align: center;
          padding: 2rem 0;
          font-size: 0.85rem;
          color: #64748b;
        }
        .predictors-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .predictor-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border: 1px solid rgba(15, 23, 42, 0.05);
          background: rgba(15, 23, 42, 0.01);
          border-radius: 12px;
          padding: 0.75rem 1rem;
          transition: all 0.2s ease;
        }
        .predictor-item:hover {
          background: rgba(15, 23, 42, 0.03);
          border-color: rgba(15, 23, 42, 0.1);
        }
        .predictor-left {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .rank-badge {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 2.25rem;
          height: 2.25rem;
          border-radius: 50%;
          background: #ffffff;
          border: 1px solid rgba(15, 23, 42, 0.06);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);
        }
        :global(.rank-icon-svg) {
          width: 1.15rem;
          height: 1.15rem;
        }
        :global(.text-amber) {
          color: #d97706;
        }
        :global(.text-silver) {
          color: #94a3b8;
        }
        :global(.text-bronze) {
          color: #b45309;
        }
        .predictor-info {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }
        .address-mono {
          font-family: monospace;
          font-size: 0.8rem;
          font-weight: 600;
          color: #334155;
        }
        .count-label {
          font-size: 0.7rem;
          color: #64748b;
          font-weight: 500;
        }
        .predictor-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.15rem;
        }
        .amount-label {
          font-family: monospace;
          font-size: 0.8rem;
          font-weight: 700;
        }
        .text-gold {
          color: #b45309;
        }
        .currency-label {
          font-size: 0.65rem;
          color: #64748b;
          font-weight: 400;
          margin-left: 0.25rem;
        }
        .stake-label {
          font-size: 0.65rem;
          color: #94a3b8;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
