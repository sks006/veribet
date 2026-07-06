'use client';

import React, { useEffect, useState } from 'react';
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
  const [loadingMarkets, setLoadingMarkets] = useState(true);
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

  // Find corresponding market PDA and state for a match
  const getMatchMarket = (matchId: string) => {
    return onChainMarkets.find((market) => {
      const matchIdStr = Buffer.from(market.account.matchIdBytes)
        .toString('utf8')
        .replace(/\0/g, '');
      return matchIdStr === matchId;
    });
  };

  // Create a prediction market on-chain for a match
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

      // Default mock token mint (e.g. WSOL for demo)
      const mockMint = new PublicKey('So11111111111111111111111111111111111111112');

      const sequence = 1;
      const targetValue = 2; // e.g. target 2 goals/points
      const kickoffTimestamp = Math.floor(Date.now() / 1000) + 300;
      const emergencyUnlockTimestamp = kickoffTimestamp + 7200;
      const marketType = 0; // 0 = Over/Under, 1 = Yes/No

      console.log(`Initializing market PDA: ${marketPda.toBase58()}`);

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

  // Filter matches
  const filteredMatches = matches.filter((m) =>
    m.homeTeam.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.awayTeam.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
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
                const onChainMarket = getMatchMarket(match.id);
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
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #cbd5e1;
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
          background: rgba(255, 255, 255, 0.1);
          color: #ffffff;
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
          background: rgba(30, 41, 59, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 14px;
          padding: 0.85rem 1rem 0.85rem 2.75rem;
          color: #ffffff;
          outline: none;
          font-size: 0.9rem;
          transition: all 0.2s ease;
        }

        .search-input:focus {
          border-color: #6366f1;
          background: rgba(30, 41, 59, 0.3);
          box-shadow: 0 0 10px rgba(99, 102, 241, 0.15);
        }

        .dashboard-grid {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 2rem;
        }

        @media (max-width: 968px) {
          .dashboard-grid {
            grid-template-columns: 1fr;
          }
        }

        .markets-column {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
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
          background: rgba(99, 102, 241, 0.04);
          border: 1px dashed rgba(99, 102, 241, 0.3);
          border-radius: 12px;
          padding: 1rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 0.75rem;
        }

        .overlay-text {
          font-size: 0.8rem;
          color: #94a3b8;
          font-weight: 500;
        }

        .initialize-pool-btn {
          background: #4f46e5;
          border: none;
          color: #ffffff;
          font-size: 0.8rem;
          font-weight: 700;
          padding: 0.5rem 1rem;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
        }

        .initialize-pool-btn:hover:not(:disabled) {
          background: #4338ca;
          transform: translateY(-1px);
        }

        .initialize-pool-btn:disabled {
          background: rgba(255, 255, 255, 0.05);
          color: #64748b;
          cursor: not-allowed;
        }

        .loading-state, .empty-state {
          background: rgba(30, 41, 59, 0.15);
          border: 1px solid rgba(255, 255, 255, 0.03);
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
          border: 3px solid rgba(99, 102, 241, 0.2);
          border-radius: 50%;
          border-top-color: #6366f1;
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
      `}</style>
    </div>
  );
}
