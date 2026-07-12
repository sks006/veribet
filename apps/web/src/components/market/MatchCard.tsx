import React, { memo, useState, useEffect } from 'react';
import Link from 'next/link';
import { Match, ParametricMarket } from '../../types';
import { TrendingUp, Play, Calendar, CheckCircle2 } from 'lucide-react';

export function CountdownTimer({ kickoffTime }: { kickoffTime: number }) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const targetMs = kickoffTime < 10000000000 ? kickoffTime * 1000 : kickoffTime;

    const updateTimer = () => {
      const diff = targetMs - Date.now();
      if (diff <= 0) {
        setTimeLeft('Started');
        return;
      }

      const hrs = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);

      const parts = [];
      if (hrs > 0) parts.push(`${hrs}h`);
      if (mins > 0 || hrs > 0) parts.push(`${mins}m`);
      parts.push(`${secs}s`);

      setTimeLeft(parts.join(' '));
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [kickoffTime]);

  return <span className="countdown-timer">{timeLeft}</span>;
}

interface MatchCardProps {
  match: Match;
  market?: ParametricMarket;
}

export const MatchCard = memo(function MatchCard({ match, market }: MatchCardProps) {
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
          <div className="status-container">
            <span className="status-badge upcoming">
              <Calendar size={12} className="inline mr-1" /> UPCOMING
            </span>
            <span className="countdown-badge">
              Starts in: <CountdownTimer kickoffTime={match.kickoffTime} />
            </span>
          </div>
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
          background: #ffffff;
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 16px;
          padding: 1.25rem;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }

        .match-card:hover {
          transform: translateY(-4px);
          border-color: rgba(9, 9, 11, 0.2);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
        }

        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .status-container {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .countdown-badge {
          font-size: 0.7rem;
          font-weight: 700;
          padding: 0.25rem 0.6rem;
          border-radius: 9999px;
          background: rgba(9, 9, 11, 0.04);
          border: 1px solid rgba(9, 9, 11, 0.1);
          color: #09090b;
          display: flex;
          align-items: center;
          gap: 0.25rem;
        }

        .sport-badge {
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #64748b;
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
          color: #dc2626;
          border: 1px solid rgba(239, 68, 68, 0.2);
        }

        .pulse-dot {
          width: 6px;
          height: 6px;
          background-color: #dc2626;
          border-radius: 50%;
          animation: pulse 1.5s infinite;
        }

        .status-badge.resolved {
          background: rgba(16, 185, 129, 0.1);
          color: #059669;
          border: 1px solid rgba(16, 185, 129, 0.2);
        }

        .status-badge.upcoming {
          background: rgba(9, 9, 11, 0.04);
          color: #09090b;
          border: 1px solid rgba(9, 9, 11, 0.1);
        }

        .teams-score-row {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.75rem;
        }

        .team-column {
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          width: 100%;
        }

        .team-name {
          font-size: 1rem;
          font-weight: 600;
          color: #0f172a;
        }

        .score-container {
          background: rgba(15, 23, 42, 0.04);
          padding: 0.4rem 1rem;
          border-radius: 12px;
          border: 1px solid rgba(15, 23, 42, 0.08);
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
          color: #0f172a;
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
          background: rgba(15, 23, 42, 0.02);
          border: 1px solid rgba(15, 23, 42, 0.04);
          border-radius: 10px;
          padding: 0.5rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.15rem;
          transition: all 0.2s ease;
        }

        .odds-button:hover {
          background: rgba(9, 9, 11, 0.04);
          border-color: rgba(9, 9, 11, 0.1);
        }

        .odds-label {
          font-size: 0.7rem;
          color: #64748b;
          font-weight: 600;
        }

        .odds-value {
          font-size: 0.9rem;
          font-weight: 700;
          color: #09090b;
        }

        .card-footer {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          align-items: stretch;
          border-top: 1px solid rgba(15, 23, 42, 0.08);
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
          color: #334155;
        }

        .predict-link {
          background: #ffffff;
          border: 1px solid #e4e4e7;
          color: #09090b;
          font-size: 0.85rem;
          font-weight: 600;
          padding: 0.5rem;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          text-decoration: none;
        }

        @media (min-width: 576px) {
          .teams-score-row {
            flex-direction: row;
            justify-content: space-between;
            gap: 1rem;
          }

          .team-column {
            flex: 1;
            width: auto;
          }

          .team-column.home {
            justify-content: flex-end;
            text-align: right;
            display: flex;
            align-items: center;
          }

          .team-column.away {
            justify-content: flex-start;
            text-align: left;
            display: flex;
            align-items: center;
          }

          .card-footer {
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
          }

          .predict-link {
            padding: 0.45rem 0.9rem;
            justify-content: flex-start;
          }
        }

        .predict-link:hover {
          background: #09090b;
          color: #ffffff;
          border-color: #09090b;
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
});
