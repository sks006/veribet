import React from 'react';
import Link from 'next/link';
import { Match, ParametricMarket } from '../../types';
import { TrendingUp, Play, Calendar, CheckCircle2 } from 'lucide-react';

interface MatchCardProps {
  match: Match;
  market?: ParametricMarket;
}

export function MatchCard({ match, market }: MatchCardProps) {
  // Calculate odds based on market pools
  const calculateOdds = () => {
    if (!market) return { oddsA: '1.90', oddsB: '1.90', oddsDraw: '3.10' };
    
    const sideA = market.poolSideA.toNumber();
    const sideB = market.poolSideB.toNumber();
    const sideDraw = market.poolSideDraw.toNumber();
    const total = sideA + sideB + sideDraw;

    if (total === 0) {
      return { oddsA: '2.00', oddsB: '2.00', oddsDraw: '3.00' };
    }

    const oddsA = sideA > 0 ? (total / sideA).toFixed(2) : '3.00';
    const oddsB = sideB > 0 ? (total / sideB).toFixed(2) : '3.00';
    const oddsDraw = sideDraw > 0 ? (total / sideDraw).toFixed(2) : '5.00';

    return { oddsA, oddsB, oddsDraw };
  };

  const { oddsA, oddsB, oddsDraw } = calculateOdds();

  return (
    <div className="match-card">
      <div className="card-header">
        <span className="sport-badge">{match.sport}</span>
        {match.status === 'LIVE' && (
          <span className="status-badge live">
            <span className="pulse-dot"></span> LIVE
          </span>
        )}
        {match.status === 'FINISHED' && (
          <span className="status-badge resolved">
            <CheckCircle2 size={12} className="inline mr-1" /> RESOLVED
          </span>
        )}
        {match.status === 'SCHEDULED' && (
          <span className="status-badge upcoming">
            <Calendar size={12} className="inline mr-1" /> UPCOMING
          </span>
        )}
      </div>

      <div className="teams-score-row">
        <div className="team-column home">
          <span className="team-name">{match.homeTeam}</span>
        </div>
        
        <div className="score-container">
          {match.status !== 'SCHEDULED' ? (
            <div className="scores">
              <span className="score">{match.homeScore}</span>
              <span className="score-separator">:</span>
              <span className="score">{match.awayScore}</span>
            </div>
          ) : (
            <span className="vs">VS</span>
          )}
        </div>

        <div className="team-column away">
          <span className="team-name">{match.awayTeam}</span>
        </div>
      </div>

      <div className="odds-grid">
        <div className="odds-button">
          <span className="odds-label">1</span>
          <span className="odds-value">{oddsA}</span>
        </div>
        <div className="odds-button">
          <span className="odds-label">X</span>
          <span className="odds-value">{oddsDraw}</span>
        </div>
        <div className="odds-button">
          <span className="odds-label">2</span>
          <span className="odds-value">{oddsB}</span>
        </div>
      </div>

      <div className="card-footer">
        <div className="pool-info">
          <span className="info-label">Total Pool:</span>
          <span className="info-value">
            {market 
              ? `${((market.poolSideA.toNumber() + market.poolSideB.toNumber() + market.poolSideDraw.toNumber()) / 1e9).toFixed(2)} SOL`
              : '0.00 SOL'
            }
          </span>
        </div>
        
        <Link href={market ? `/market/${market.marketId.toString()}` : `/market/${match.id}`} className="predict-link">
          Place Position <TrendingUp size={16} className="ml-1" />
        </Link>
      </div>

      <style jsx>{`
        .match-card {
          background: rgba(30, 41, 59, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 16px;
          padding: 1.25rem;
          backdrop-filter: blur(12px);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }

        .match-card:hover {
          transform: translateY(-4px);
          border-color: rgba(99, 102, 241, 0.3);
          box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3), 0 0 15px rgba(99, 102, 241, 0.1);
        }

        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .sport-badge {
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #94a3b8;
          font-weight: 500;
        }

        .status-badge {
          font-size: 0.75rem;
          font-weight: 600;
          padding: 0.25rem 0.6rem;
          border-radius: 9999px;
          display: flex;
          align-items: center;
          gap: 0.25rem;
        }

        .status-badge.live {
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
          border: 1px solid rgba(239, 68, 68, 0.2);
        }

        .pulse-dot {
          width: 6px;
          height: 6px;
          background-color: #ef4444;
          border-radius: 50%;
          animation: pulse 1.5s infinite;
        }

        .status-badge.resolved {
          background: rgba(16, 185, 129, 0.1);
          color: #10b981;
          border: 1px solid rgba(16, 185, 129, 0.2);
        }

        .status-badge.upcoming {
          background: rgba(99, 102, 241, 0.1);
          color: #6366f1;
          border: 1px solid rgba(99, 102, 241, 0.2);
        }

        .teams-score-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
        }

        .team-column {
          flex: 1;
          display: flex;
          align-items: center;
        }

        .team-column.home {
          justify-content: flex-end;
          text-align: right;
        }

        .team-column.away {
          justify-content: flex-start;
          text-align: left;
        }

        .team-name {
          font-size: 1rem;
          font-weight: 600;
          color: #f8fafc;
        }

        .score-container {
          background: rgba(15, 23, 42, 0.6);
          padding: 0.4rem 1rem;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.05);
          min-width: 70px;
          display: flex;
          justify-content: center;
          align-items: center;
        }

        .scores {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-family: monospace;
          font-size: 1.15rem;
          font-weight: 700;
          color: #f8fafc;
        }

        .vs {
          font-size: 0.8rem;
          font-weight: 700;
          color: #64748b;
          letter-spacing: 0.05em;
        }

        .odds-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 0.5rem;
        }

        .odds-button {
          background: rgba(15, 23, 42, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.03);
          border-radius: 10px;
          padding: 0.5rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.15rem;
          transition: all 0.2s ease;
        }

        .odds-button:hover {
          background: rgba(99, 102, 241, 0.08);
          border-color: rgba(99, 102, 241, 0.2);
        }

        .odds-label {
          font-size: 0.7rem;
          color: #64748b;
          font-weight: 600;
        }

        .odds-value {
          font-size: 0.9rem;
          font-weight: 700;
          color: #38bdf8;
        }

        .card-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          padding-top: 0.85rem;
        }

        .pool-info {
          display: flex;
          flex-direction: column;
          gap: 0.1rem;
        }

        .info-label {
          font-size: 0.7rem;
          color: #64748b;
        }

        .info-value {
          font-size: 0.85rem;
          font-weight: 600;
          color: #e2e8f0;
        }

        .predict-link {
          background: rgba(99, 102, 241, 0.1);
          border: 1px solid rgba(99, 102, 241, 0.2);
          color: #818cf8;
          font-size: 0.85rem;
          font-weight: 600;
          padding: 0.45rem 0.9rem;
          border-radius: 10px;
          display: flex;
          align-items: center;
          transition: all 0.2s ease;
          text-decoration: none;
        }

        .predict-link:hover {
          background: #4f46e5;
          color: #ffffff;
          border-color: #4f46e5;
          transform: scale(1.03);
        }

        @keyframes pulse {
          0% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7);
          }
          70% {
            transform: scale(1);
            box-shadow: 0 0 0 5px rgba(239, 68, 68, 0);
          }
          100% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
          }
        }
      `}</style>
    </div>
  );
}
