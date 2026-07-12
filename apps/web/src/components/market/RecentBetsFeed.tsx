import React, { useEffect, useState } from 'react';
import { ShieldCheck, ArrowUpRight, Coins } from 'lucide-react';

interface Bet {
  id: string;
  type: 'standard' | 'prop';
  marketTitle: string;
  bettor: string;
  amount: number;
  side: 'YES' | 'NO';
  timestamp: number;
}

interface RecentBetsFeedProps {
  marketId: string;
}

export function RecentBetsFeed({ marketId }: RecentBetsFeedProps) {
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBets = async () => {
    try {
      const res = await fetch(`/api/markets/${marketId}/bets`);
      if (res.ok) {
        const data = await res.json();
        if (data.bets) {
          setBets(data.bets);
        }
      }
    } catch (err) {
      console.error('Error fetching recent bets:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBets();
    const interval = setInterval(fetchBets, 3000);
    return () => clearInterval(interval);
  }, [marketId]);

  return (
    <div className="card-container shadow-premium">
      <div className="card-header-bar flex-row">
        <div>
          <h3 className="card-title">
            <Coins className="title-icon" />
            Recent Activity
          </h3>
          <p className="card-subtitle">Live feed of parimutuel & prop placements</p>
        </div>
        <div className="live-badge">
          <span className="pulse-dot">
            <span className="ping-effect"></span>
            <span className="solid-dot"></span>
          </span>
          Live Feed
        </div>
      </div>

      {loading && bets.length === 0 ? (
        <div className="loading-state">
          <div className="spinner-mini" />
        </div>
      ) : bets.length === 0 ? (
        <div className="empty-state">
          No recent positions placed on this market yet.
        </div>
      ) : (
        <div className="bets-scroll-area">
          {bets.map((bet) => (
            <div key={bet.id} className="bet-item">
              <div className="bet-left">
                <span className="bet-title">{bet.marketTitle}</span>
                <div className="bet-meta">
                  <span className="bettor-badge">
                    {bet.bettor.slice(0, 4)}...{bet.bettor.slice(-4)}
                  </span>
                  <span className="dot">•</span>
                  <span>{new Date(bet.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>

              <div className="bet-right">
                <span className={`side-badge ${bet.side.toLowerCase()}`}>
                  {bet.side}
                </span>
                <div className="bet-amount-info">
                  <span className="amount-value">
                    {bet.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    <span className="currency-label">USDC</span>
                  </span>
                  <span className="type-label">{bet.type}</span>
                </div>
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
          display: flex;
          justify-content: space-between;
          align-items: center;
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
        .title-icon {
          color: #64748b;
          width: 1.2rem;
          height: 1.2rem;
        }
        .card-subtitle {
          font-size: 0.75rem;
          color: #64748b;
          margin: 0.25rem 0 0 0;
        }
        .live-badge {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          background: rgba(16, 185, 129, 0.1);
          color: #059669;
          font-size: 0.7rem;
          font-weight: 700;
          padding: 0.2rem 0.5rem;
          border-radius: 9999px;
          border: 1px solid rgba(16, 185, 129, 0.2);
        }
        .pulse-dot {
          position: relative;
          display: flex;
          width: 0.35rem;
          height: 0.35rem;
        }
        .ping-effect {
          position: absolute;
          width: 100%;
          height: 100%;
          background: #10b981;
          border-radius: 50%;
          animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;
          opacity: 0.75;
        }
        .solid-dot {
          position: relative;
          width: 0.35rem;
          height: 0.35rem;
          background: #10b981;
          border-radius: 50%;
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
        .bets-scroll-area {
          max-height: 300px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          padding-right: 0.25rem;
        }
        .bets-scroll-area::-webkit-scrollbar {
          width: 4px;
        }
        .bets-scroll-area::-webkit-scrollbar-thumb {
          background: rgba(15, 23, 42, 0.1);
          border-radius: 2px;
        }
        .bet-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border: 1px solid rgba(15, 23, 42, 0.05);
          background: rgba(15, 23, 42, 0.01);
          border-radius: 12px;
          padding: 0.75rem 1rem;
          transition: all 0.2s ease;
        }
        .bet-item:hover {
          background: rgba(15, 23, 42, 0.03);
          border-color: rgba(15, 23, 42, 0.1);
        }
        .bet-left {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        .bet-title {
          font-size: 0.8rem;
          font-weight: 600;
          color: #334155;
          max-w: 220px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .bet-meta {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.65rem;
          color: #64748b;
        }
        .bettor-badge {
          font-family: monospace;
          background: rgba(15, 23, 42, 0.04);
          border: 1px solid rgba(15, 23, 42, 0.05);
          padding: 0.05rem 0.25rem;
          border-radius: 4px;
        }
        .dot {
          color: #94a3b8;
        }
        .bet-right {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .side-badge {
          font-size: 0.7rem;
          font-weight: 750;
          padding: 0.15rem 0.4rem;
          border-radius: 4px;
        }
        .side-badge.yes {
          background: rgba(16, 185, 129, 0.1);
          color: #059669;
          border: 1px solid rgba(16, 185, 129, 0.2);
        }
        .side-badge.no {
          background: rgba(239, 68, 68, 0.1);
          color: #dc2626;
          border: 1px solid rgba(239, 68, 68, 0.2);
        }
        .bet-amount-info {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.1rem;
        }
        .amount-value {
          font-family: monospace;
          font-size: 0.8rem;
          font-weight: 700;
          color: #0f172a;
        }
        .currency-label {
          font-size: 0.65rem;
          color: #64748b;
          font-weight: 400;
          margin-left: 0.15rem;
        }
        .type-label {
          font-size: 0.6rem;
          color: #94a3b8;
          text-transform: uppercase;
          font-weight: 600;
          letter-spacing: 0.05em;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes ping {
          75%, 100% {
            transform: scale(2);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
