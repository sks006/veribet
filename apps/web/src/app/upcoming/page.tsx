'use client';

import React, { useEffect, useState } from 'react';
import { useTxLine } from '../../hooks/useTxLine';
import { useProgram } from '../../hooks/useProgram';
import { MatchCard } from '../../components/market/MatchCard';
import { getMarketPda, getVaultPda } from '../../lib/solana';
import { useWallet } from '@solana/wallet-adapter-react';
import { Search, RefreshCw, Calendar, Trophy, Landmark } from 'lucide-react';
import { PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';

export default function UpcomingPage() {
  const { matches, loading: matchesLoading } = useTxLine();
  const { program } = useProgram();
  const { publicKey } = useWallet();
  const [onChainMarkets, setOnChainMarkets] = useState<any[]>([]);
  const [loadingMarkets, setLoadingMarkets] = useState(true);
  const [inputValue, setInputValue] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [creatingMarket, setCreatingMarket] = useState<string | null>(null);

  const fetchOnChainMarkets = async () => {
    if (!program) {
      setLoadingMarkets(false);
      return;
    }
    try {
      setLoadingMarkets(true);
      const accounts = await program.account.parametricMarket.all();
      setOnChainMarkets(accounts);
    } catch (e) {
      console.error('Failed to load on-chain markets:', e);
    } finally {
      setLoadingMarkets(false);
    }
  };

  useEffect(() => {
    fetchOnChainMarkets();
  }, [program]);

  // Debounce search term update
  useEffect(() => {
    const handler = setTimeout(() => {
      setSearchTerm(inputValue);
    }, 250);
    return () => clearTimeout(handler);
  }, [inputValue]);

  // Memoize market map lookup
  const marketMap = React.useMemo(() => {
    const map = new Map<string, any>();
    onChainMarkets.forEach((market) => {
      const matchIdStr = Buffer.from(market.account.matchIdBytes)
        .toString('utf8')
        .replace(/\0/g, '');
      map.set(matchIdStr, market);
    });
    return map;
  }, [onChainMarkets]);

  // Create prediction market on-chain
  const handleCreateMarket = async (matchId: string) => {
    if (!program || !publicKey) {
      alert('Please connect your wallet first.');
      return;
    }

    setCreatingMarket(matchId);
    try {
      const marketId = Math.floor(Math.random() * 10000000);
      const marketPda = getMarketPda(marketId);
      const vaultPda = getVaultPda(marketPda);

      const matchIdBytes = Buffer.alloc(16);
      Buffer.from(matchId).copy(matchIdBytes);

      // Default mock token mint (WSOL)
      const mockMint = new PublicKey('So11111111111111111111111111111111111111112');

      const sequence = 1;
      const targetValue = 2; // target value
      const kickoffTimestamp = Math.floor(Date.now() / 1000) + 300;
      const emergencyUnlockTimestamp = kickoffTimestamp + 7200;
      const marketType = 0; // Over/Under

      const txSig = await program.methods
        .createMarket(
          new anchor.BN(marketId),
          new anchor.BN(sequence),
          Array.from(matchIdBytes) as any,
          targetValue,
          new anchor.BN(kickoffTimestamp),
          new anchor.BN(emergencyUnlockTimestamp),
          marketType
        )
        .accounts({
          market: marketPda,
          vaultMint: mockMint,
          vaultTokenAccount: vaultPda,
          authority: publicKey,
        } as any)
        .rpc();

      alert(`Market created successfully! Signature: ${txSig}`);
      await fetchOnChainMarkets();
    } catch (err: any) {
      console.error(err);
      alert(`Market initialization failed: ${err.message}`);
    } finally {
      setCreatingMarket(null);
    }
  };

  // Filter and split matches into World Cup and Club matches
  const { worldCupMatches, clubMatches } = React.useMemo(() => {
    const filtered = matches.filter((m) => {
      const isFriendly = m.sport?.toLowerCase().includes('friendlies') || m.sport?.toLowerCase().includes('friendly');
      if (isFriendly) return false;

      return (
        m.homeTeam.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.awayTeam.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.id.toLowerCase().includes(searchTerm.toLowerCase())
      );
    });

    const wc = filtered.filter(m => m.sport === 'World Cup 🏆' || m.id.endsWith('WC26'));
    const clubs = filtered.filter(m => m.sport !== 'World Cup 🏆' && !m.id.endsWith('WC26'));

    return { worldCupMatches: wc, clubMatches: clubs };
  }, [matches, searchTerm]);

  const formatKickoffTime = (timestamp: number) => {
    const targetMs = timestamp < 10000000000 ? timestamp * 1000 : timestamp;
    return new Date(targetMs).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  return (
    <div className="upcoming-page">
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Match Schedule</h1>
          <p className="page-subtitle">Browse upcoming and live World Cup and Club matches powered by TxLINE</p>
        </div>
        <button className="refresh-btn" onClick={fetchOnChainMarkets}>
          <RefreshCw size={14} className={loadingMarkets ? 'animate-spin' : ''} /> Sync On-Chain
        </button>
      </div>

      <div className="search-bar-wrapper">
        <Search className="search-icon" size={16} />
        <input
          type="text"
          placeholder="Search matches by team or league..."
          className="search-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
        />
      </div>

      {matchesLoading ? (
        <div className="loading-state">
          <span className="spinner"></span>
          <p>Connecting to TxLINE SSE Multiplexer...</p>
        </div>
      ) : (
        <div className="schedule-layout">
          {/* Section: World Cup */}
          <div className="schedule-section">
            <div className="section-title-row">
              <Trophy className="section-icon wc-icon" size={24} />
              <h2>World Cup 2026 Fixtures</h2>
            </div>
            {worldCupMatches.length === 0 ? (
              <div className="no-fixtures-card">
                <p>No World Cup matches scheduled or live.</p>
              </div>
            ) : (
              <div className="fixtures-list">
                {worldCupMatches.map((match) => {
                  const onChainMarket = marketMap.get(match.id);
                  return (
                    <div key={match.id} className="fixture-item">
                      <div className="kickoff-label">
                        <Calendar size={12} />
                        <span>{formatKickoffTime(match.kickoffTime)}</span>
                      </div>
                      <div className="fixture-card-wrapper">
                        <MatchCard match={match} market={onChainMarket?.account} />
                        {!onChainMarket && (
                          <div className="init-market-overlay">
                            <p>No active on-chain pool.</p>
                            <button
                              className="init-pool-btn"
                              onClick={() => handleCreateMarket(match.id)}
                              disabled={creatingMarket === match.id}
                            >
                              {creatingMarket === match.id ? (
                                <span className="mini-spinner"></span>
                              ) : 'Initialize Prediction Pool'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section: Club Matches */}
          <div className="schedule-section">
            <div className="section-title-row">
              <Landmark className="section-icon club-icon" size={24} />
              <h2>Club & League Matches</h2>
            </div>
            {clubMatches.length === 0 ? (
              <div className="no-fixtures-card">
                <p>No club or league matches scheduled or live.</p>
              </div>
            ) : (
              <div className="fixtures-list">
                {clubMatches.map((match) => {
                  const onChainMarket = marketMap.get(match.id);
                  return (
                    <div key={match.id} className="fixture-item">
                      <div className="kickoff-label">
                        <Calendar size={12} />
                        <span>{formatKickoffTime(match.kickoffTime)}</span>
                      </div>
                      <div className="fixture-card-wrapper">
                        <MatchCard match={match} market={onChainMarket?.account} />
                        {!onChainMarket && (
                          <div className="init-market-overlay">
                            <p>No active on-chain pool.</p>
                            <button
                              className="init-pool-btn"
                              onClick={() => handleCreateMarket(match.id)}
                              disabled={creatingMarket === match.id}
                            >
                              {creatingMarket === match.id ? (
                                <span className="mini-spinner"></span>
                              ) : 'Initialize Prediction Pool'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        .upcoming-page {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem 1.5rem;
        }

        .page-header-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2rem;
        }

        .page-title {
          font-size: 2.2rem;
          font-weight: 800;
          color: #0f172a;
          margin-bottom: 0.5rem;
        }

        .page-subtitle {
          color: #64748b;
          font-size: 1rem;
        }

        .refresh-btn {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          background: #ffffff;
          border: 1px solid rgba(15, 23, 42, 0.08);
          padding: 0.6rem 1.2rem;
          border-radius: 12px;
          font-size: 0.85rem;
          font-weight: 600;
          color: #0f172a;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .refresh-btn:hover {
          background: #f8fafc;
          border-color: rgba(15, 23, 42, 0.15);
        }

        .search-bar-wrapper {
          position: relative;
          margin-bottom: 3rem;
          width: 100%;
        }

        .search-icon {
          position: absolute;
          left: 1.25rem;
          top: 50%;
          transform: translateY(-50%);
          color: #94a3b8;
        }

        .search-input {
          width: 100%;
          padding: 1rem 1rem 1rem 3rem;
          border-radius: 16px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: #ffffff;
          font-size: 0.95rem;
          font-weight: 500;
          color: #0f172a;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.01);
          outline: none;
          transition: all 0.2s ease;
        }

        .search-input:focus {
          border-color: #4f46e5;
          box-shadow: 0 4px 20px rgba(79, 70, 229, 0.05);
        }

        .schedule-layout {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 3rem;
        }

        @media (max-width: 968px) {
          .schedule-layout {
            grid-template-columns: 1fr;
            gap: 2.5rem;
          }
        }

        .schedule-section {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .section-title-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          border-bottom: 2px solid #f1f5f9;
          padding-bottom: 0.75rem;
        }

        .section-title-row h2 {
          font-size: 1.35rem;
          font-weight: 800;
          color: #0f172a;
        }

        .section-icon {
          padding: 6px;
          border-radius: 8px;
        }

        .wc-icon {
          background: rgba(217, 119, 6, 0.1);
          color: #d97706;
        }

        .club-icon {
          background: rgba(79, 70, 229, 0.1);
          color: #4f46e5;
        }

        .fixtures-list {
          display: flex;
          flex-direction: column;
          gap: 2rem;
        }

        .fixture-item {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .kickoff-label {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.8rem;
          font-weight: 700;
          color: #64748b;
          padding-left: 0.25rem;
        }

        .fixture-card-wrapper {
          position: relative;
          background: #ffffff;
          border-radius: 20px;
          border: 1px solid rgba(15, 23, 42, 0.06);
          overflow: hidden;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
          transition: all 0.2s ease;
        }

        .fixture-card-wrapper:hover {
          border-color: rgba(99, 102, 241, 0.25);
          box-shadow: 0 10px 30px rgba(99, 102, 241, 0.05);
        }

        .init-market-overlay {
          background: rgba(248, 250, 252, 0.95);
          border-top: 1px dashed rgba(15, 23, 42, 0.08);
          padding: 1rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
        }

        .init-market-overlay p {
          font-size: 0.8rem;
          font-weight: 600;
          color: #475569;
        }

        .init-pool-btn {
          background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
          border: none;
          color: #ffffff;
          font-weight: 700;
          font-size: 0.8rem;
          padding: 0.5rem 1.2rem;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 4px 10px rgba(79, 70, 229, 0.15);
        }

        .init-pool-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 14px rgba(79, 70, 229, 0.25);
        }

        .init-pool-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .no-fixtures-card {
          background: #f8fafc;
          border: 1px dashed rgba(15, 23, 42, 0.08);
          border-radius: 16px;
          padding: 3rem 1.5rem;
          text-align: center;
          color: #64748b;
          font-size: 0.95rem;
          font-weight: 500;
        }

        .loading-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 6rem 2rem;
          gap: 1rem;
          color: #64748b;
        }

        .spinner {
          width: 32px;
          height: 32px;
          border: 3px solid rgba(79, 70, 229, 0.15);
          border-top-color: #4f46e5;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        .mini-spinner {
          display: inline-block;
          width: 12px;
          height: 12px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: #ffffff;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
