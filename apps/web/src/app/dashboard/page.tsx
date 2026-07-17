'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTxLine } from '../../hooks/useTxLine';
import { useProgram } from '../../hooks/useProgram';
import { MatchCard } from '../../components/market/MatchCard';
import { LeaderboardTable } from '../../components/leaderboard/LeaderboardTable';
import { getMarketPda, getVaultPda } from '../../lib/solana';
import { useWallet } from '@solana/wallet-adapter-react';
import { PlusCircle, Search, RefreshCw, Layers } from 'lucide-react';
import { PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';

export default function DashboardPage() {
  const { matches, loading: matchesLoading } = useTxLine();
  const { program } = useProgram();
  const { publicKey } = useWallet();
  const [onChainMarkets, setOnChainMarkets] = useState<any[]>([]);
  const [propMarkets, setPropMarkets] = useState<any[]>([]);
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
      const [accounts, propAccounts] = await Promise.all([
        program.account.parametricMarket.all(),
        program.account.binaryPropMarket.all([
          {
            memcmp: {
              offset: 88,
              bytes: "1", // Base58 representation of 0x00 (LifecycleState::Active)
            }
          }
        ]),
      ]);
      setOnChainMarkets(accounts);
      setPropMarkets(propAccounts);
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

  // Memoize market map lookup for O(1) rendering checks
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

  // Create a prediction market on-chain for a match
  const handleCreateMarket = async (matchId: string) => {
    if (!program || !publicKey) {
      alert('Please connect your wallet first.');
      return;
    }

    const match = matches.find(m => m.id === matchId);
    if (!match) {
      alert('Match details not found.');
      return;
    }

    const kickoffTimestamp = Math.floor(match.kickoffTime / 1000);
    const nowSecs = Math.floor(Date.now() / 1000);
    if (kickoffTimestamp <= nowSecs) {
      alert('Cannot initialize a prediction market for a match that has already kicked off.');
      return;
    }

    setCreatingMarket(matchId);
    try {
      const marketId = Math.floor(Math.random() * 10000000);
      const marketPda = getMarketPda(marketId);
      const vaultPda = getVaultPda(marketPda);

      const matchIdBytes = Buffer.alloc(16);
      Buffer.from(matchId).copy(matchIdBytes);

      // Default mock token mint (e.g. WSOL for demo)
      const mockMint = new PublicKey('So11111111111111111111111111111111111111112');

      const sequence = 1;
      const targetValue = 2; // e.g. target 2 goals/points
      const emergencyUnlockTimestamp = kickoffTimestamp + 7200;
      const marketType = 0; // 0 = Over/Under, 1 = Yes/No

      console.log(`Initializing market PDA: ${marketPda.toBase58()} with kickoff time ${new Date(kickoffTimestamp * 1000).toISOString()}`);

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

      console.log(`Market initialized successfully! Tx: ${txSig}`);
      alert(`Market created successfully! Signature: ${txSig}`);
      await fetchOnChainMarkets();
    } catch (err: any) {
      console.error(err);
      alert(`Market initialization failed: ${err.message}`);
    } finally {
      setCreatingMarket(null);
    }
  };

  // Memoize filtered matches to avoid re-calculating on every render
  const filteredMatches = React.useMemo(() => {
    return matches.filter((m) => {
      const isFriendly = m.sport?.toLowerCase().includes('friendlies') || m.sport?.toLowerCase().includes('friendly');
      if (isFriendly) return false;

      return (
        m.homeTeam.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.awayTeam.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.id.toLowerCase().includes(searchTerm.toLowerCase())
      );
    });
  }, [matches, searchTerm]);

  // Filter prop markets dynamically
  const filteredMarkets = React.useMemo(() => {
    return propMarkets.filter((market) => {
      const matchIdStr = Buffer.from(market.account.matchId)
        .toString('utf8')
        .replace(/\0/g, '');
      return (
        matchIdStr.toLowerCase().includes(searchTerm.toLowerCase()) ||
        market.account.displayTitle.toLowerCase().includes(searchTerm.toLowerCase())
      );
    });
  }, [propMarkets, searchTerm]);

  return (
    <div className="dashboard-page">
      <div className="dashboard-header-row">
        <div>
          <h1 className="page-title">Live Prediction Markets</h1>
          <p className="page-subtitle">Predict real-time match outcomes settled directly by TxLINE streams</p>
        </div>
        <button className="refresh-btn" onClick={fetchOnChainMarkets}>
          <RefreshCw size={14} className={loadingMarkets ? 'animate-spin' : ''} /> Sync On-Chain
        </button>
      </div>

      <div className="search-bar-wrapper">
        <Search className="search-icon" size={16} />
        <input
          type="text"
          placeholder="Search by team or match identifier..."
          className="search-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
        />
      </div>

      <div className="dashboard-grid">
        <div className="markets-column">
          {matchesLoading ? (
            <div className="loading-state">
              <span className="spinner"></span>
              <p>Connecting to TxLINE SSE Multiplexer...</p>
            </div>
          ) : filteredMatches.length === 0 ? (
            <div className="empty-state">
              <p>No active matches found matching "{searchTerm}"</p>
            </div>
          ) : (
            <div className="cards-grid">
              {filteredMatches.map((match) => {
                const onChainMarket = marketMap.get(match.id);
                return (
                  <div key={match.id} className="market-item-card">
                    <MatchCard match={match} market={onChainMarket?.account} />
                    
                    {!onChainMarket && (
                      <div className="initialize-market-overlay">
                        <p className="overlay-text">No active on-chain pool for this match.</p>
                        <button
                          className="initialize-pool-btn"
                          onClick={() => handleCreateMarket(match.id)}
                          disabled={creatingMarket === match.id}
                        >
                          {creatingMarket === match.id ? (
                            <span className="mini-spinner"></span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <PlusCircle size={14} /> Initialize Prediction Pool
                            </span>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Prop Markets Section */}
          {filteredMarkets.length > 0 && (
            <div className="prop-markets-section">
              <h2 className="section-title">Binary Prop Markets</h2>
              <div className="prop-cards-grid">
                {filteredMarkets.map((market) => {
                  const eventTypes = ["Fouls", "Red Cards", "Yellow Cards", "Corners", "Free Kicks"];
                  const eventName = eventTypes[market.account.eventType] || "Event";
                  const matchIdStr = Buffer.from(market.account.matchId)
                    .toString('utf8')
                    .replace(/\0/g, '');
                  return (
                    <Link 
                      key={market.publicKey.toBase58()} 
                      href={`/market/${matchIdStr}`}
                      className="prop-market-card-link"
                      style={{ textDecoration: 'none' }}
                    >
                      <div className="prop-market-card">
                        {/* Header */}
                        <div className="market-header">
                          <span className="event-title">{market.account.displayTitle || eventName}</span>
                          <span className={`status-badge ${market.account.bettable ? 'active' : 'closed'}`}>
                            {market.account.bettable ? 'BETTABLE' : 'CLOSED'}
                          </span>
                        </div>

                        {/* Pool Data */}
                        <div className="pool-data">
                          <div className="pool-row">
                            <span className='text-green-500'>YES Pool</span>
                            <span className="pool-value">{(market.account.totalYesPool.toNumber() / 1e9).toFixed(3)} SOL</span>
                          </div>
                          <div className="pool-row">
                            <span className='text-red-500'>NO Pool</span>
                            <span className="pool-value">{(market.account.totalNoPool.toNumber() / 1e9).toFixed(3)} SOL</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="sidebar-column">
          <LeaderboardTable />
        </div>
      </div>

      <style jsx>{`
        .dashboard-page {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .dashboard-header-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 1rem;
        }

        .refresh-btn {
          background: rgba(15, 23, 42, 0.05);
          border: 1px solid rgba(15, 23, 42, 0.1);
          color: #475569;
          font-size: 0.85rem;
          font-weight: 600;
          padding: 0.5rem 1rem;
          border-radius: 10px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.4rem;
          transition: all 0.2s ease;
        }

        .refresh-btn:hover {
          background: rgba(15, 23, 42, 0.1);
          color: #0f172a;
        }

        .search-bar-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .search-icon {
          position: absolute;
          left: 1.25rem;
          color: #64748b;
        }

        .search-input {
          width: 100%;
          background: #ffffff;
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 14px;
          padding: 0.85rem 1rem 0.85rem 2.75rem;
          color: #0f172a;
          outline: none;
          font-size: 0.9rem;
          transition: all 0.2s ease;
        }

        .search-input:focus {
          border-color: #09090b;
          box-shadow: 0 0 0 2px rgba(9, 9, 11, 0.05);
        }

        .dashboard-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 2rem;
          min-width: 0;
        }

        @media (min-width: 969px) {
          .dashboard-grid {
            grid-template-columns: 2fr 1fr;
          }
        }

        .markets-column {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          min-width: 0;
        }

        .sidebar-column {
          min-width: 0;
        }

        .cards-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1.5rem;
        }

        .market-item-card {
          position: relative;
        }

        .initialize-market-overlay {
          margin-top: 0.75rem;
          background: rgba(9, 9, 11, 0.02);
          border: 1px dashed rgba(9, 9, 11, 0.15);
          border-radius: 12px;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 0.75rem;
        }

        .overlay-text {
          font-size: 0.8rem;
          color: #475569;
          font-weight: 500;
        }

        .initialize-pool-btn {
          background: #09090b;
          border: 1px solid #09090b;
          color: #ffffff;
          font-size: 0.8rem;
          font-weight: 700;
          padding: 0.5rem 1rem;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        @media (min-width: 576px) {
          .initialize-market-overlay {
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
          }
          .initialize-pool-btn {
            justify-content: flex-start;
          }
        }

        .initialize-pool-btn:hover:not(:disabled) {
          background: #18181b;
          border-color: #18181b;
          transform: translateY(-1px);
        }

        .initialize-pool-btn:disabled {
          background: rgba(15, 23, 42, 0.05);
          color: #64748b;
          cursor: not-allowed;
        }

        .loading-state, .empty-state {
          background: #ffffff;
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 20px;
          padding: 3rem;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1rem;
          color: #64748b;
          font-size: 0.95rem;
        }

        .spinner {
          display: inline-block;
          width: 32px;
          height: 32px;
          border: 3px solid rgba(9, 9, 11, 0.1);
          border-radius: 50%;
          border-top-color: #09090b;
          animation: spin 1s ease-in-out infinite;
        }

        .mini-spinner {
          display: inline-block;
          width: 14px;
          height: 14px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-radius: 50%;
          border-top-color: #ffffff;
          animation: spin 0.8s ease-in-out infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .prop-markets-section {
          margin-top: 2rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .section-title {
          font-size: 1.25rem;
          font-weight: 700;
          color: #0f172a;
          margin: 0;
        }

        .prop-cards-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 1.25rem;
        }

        .prop-market-card-link {
          text-decoration: none;
          display: block;
          color: inherit;
        }

        .prop-market-card {
          background: #ffffff;
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 16px;
          padding: 1.25rem;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.01);
          display: flex;
          flex-direction: column;
          gap: 1rem;
          transition: all 0.2s ease;
        }

        .prop-market-card:hover {
          border-color: rgba(15, 23, 42, 0.15);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03);
          transform: translateY(-2px);
        }

        .market-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .event-title {
          font-size: 0.95rem;
          font-weight: 700;
          color: #0f172a;
        }

        .status-badge {
          font-size: 0.65rem;
          font-weight: 700;
          padding: 0.2rem 0.5rem;
          border-radius: 6px;
        }

        .status-badge.active {
          background: rgba(16, 185, 129, 0.1);
          color: #059669;
        }

        .status-badge.closed {
          background: rgba(148, 163, 184, 0.1);
          color: #64748b;
        }

        .pool-data {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          background: rgba(15, 23, 42, 0.02);
          border-radius: 10px;
          padding: 0.75rem;
        }

        .pool-row {
          display: flex;
          justify-content: space-between;
          font-size: 0.8rem;
          color: #64748b;
          font-weight: 500;
        }

        .pool-value {
          font-weight: 700;
          color: #0f172a;
        }
      `}</style>
    </div>
  );
}

