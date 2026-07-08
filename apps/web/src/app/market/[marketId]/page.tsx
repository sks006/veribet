'use client';

import React, { use, useState, useEffect } from 'react';
import { useProgram } from '../../../hooks/useProgram';
import { useTxLine } from '../../../hooks/useTxLine';
import { useAccountSubscription } from '../../../hooks/useAccountSubscription';
import { getMarketPda, getUserPositionPda, getVaultPda } from '../../../lib/solana';
import { PredictionForm } from '../../../components/market/PredictionForm';
import { ProofReceiptModal } from '../../../components/common/ProofReceiptModal';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { ShieldCheck, Info, User, DollarSign, Calendar, TrendingUp } from 'lucide-react';

interface PageProps {
  params: Promise<{ marketId: string }>;
}

export default function MarketDetailPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const marketIdStr = resolvedParams.marketId;
  const { matches } = useTxLine();
  const { program, connection } = useProgram();
  const { publicKey } = useWallet();

  const [marketPda, setMarketPda] = useState<PublicKey | null>(null);
  const [userPositionPda, setUserPositionPda] = useState<PublicKey | null>(null);
  const [userPosition, setUserPosition] = useState<any | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [showProofModal, setShowProofModal] = useState(false);

  // Derive PDAs
  useEffect(() => {
    const marketIdNum = parseInt(marketIdStr);
    if (!isNaN(marketIdNum)) {
      const pda = getMarketPda(marketIdNum);
      setMarketPda(pda);
      if (publicKey) {
        setUserPositionPda(getUserPositionPda(pda, publicKey));
      }
    }
  }, [marketIdStr, publicKey]);

  // Load account subscription for market changes
  const { marketState, loading: marketLoading } = useAccountSubscription(
    connection,
    marketPda,
    program
  );

  // Load user position account
  const fetchUserPosition = async () => {
    if (!program || !userPositionPda) return;
    try {
      const pos = await program.account.userPosition.fetch(userPositionPda);
      setUserPosition(pos);
    } catch (e) {
      setUserPosition(null);
    }
  };

  useEffect(() => {
    fetchUserPosition();
  }, [program, userPositionPda]);

  // Match info from TxLINE stream
  const match = matches.find(m => m.id === marketIdStr || (marketState && 
    Buffer.from(marketState.matchIdBytes).toString('utf8').replace(/\0/g, '') === m.id
  ));

  const handleClaim = async () => {
    if (!program || !publicKey || !marketPda || !userPositionPda) return;
    setClaiming(true);
    try {
      const marketData = await program.account.parametricMarket.fetch(marketPda);
      
      // Get collateral token mint
      let vaultMint = PublicKey.default;
      try {
        const vaultInfo: any = await connection.getParsedAccountInfo(marketData.vaultTokenAccount);
        vaultMint = new PublicKey(vaultInfo.value?.data.parsed.info.mint);
      } catch {
        vaultMint = new PublicKey('So11111111111111111111111111111111111111112'); // WSOL fallback
      }

      const userTokenAccount = await getAssociatedTokenAddress(vaultMint, publicKey);

      const txSig = await program.methods
        .claimPosition()
        .accounts({
          market: marketPda,
          userPosition: userPositionPda,
          userTokenAccount: userTokenAccount,
          vaultTokenAccount: marketData.vaultTokenAccount,
          authority: publicKey,
        } as any)
        .rpc();

      console.log(`Claimed successfully! Signature: ${txSig}`);
      alert(`Claimed payout successfully! Signature: ${txSig}`);
      await fetchUserPosition();
    } catch (err: any) {
      console.error(err);
      alert(`Claim failed: ${err.message}`);
    } finally {
      setClaiming(false);
    }
  };

  if (marketLoading || !marketState) {
    return (
      <div className="market-loading-wrapper">
        <span className="spinner"></span>
        <p>Loading parametric market details...</p>
      </div>
    );
  }

  const matchTitle = match ? `${match.homeTeam} vs ${match.awayTeam}` : 'Parametric Market';
  const totalPool = (marketState.poolSideA.toNumber() + marketState.poolSideB.toNumber() + marketState.poolSideDraw.toNumber()) / 1e9;

  return (
    <div className="market-detail-page">
      <div className="detail-header">
        <div className="header-breadcrumbs">
          <span className="breadcrumb-link">Markets</span>
          <span className="breadcrumb-separator">/</span>
          <span className="breadcrumb-active">{matchTitle}</span>
        </div>
        <h1 className="page-title">{matchTitle}</h1>
        {match && (
          <div className="match-status-row">
            <span className={`status-badge ${match.status.toLowerCase()}`}>{match.status}</span>
            <span className="status-score">{match.homeScore} - {match.awayScore}</span>
          </div>
        )}
      </div>

      <div className="detail-layout">
        <div className="form-column">
          {marketState.isResolved ? (
            <div className="resolved-status-card">
              <ShieldCheck className="resolved-icon" size={48} />
              <h3 className="resolved-title">Market Resolved</h3>
              <p className="resolved-desc">
                This market has been resolved by the crank node using verified cryptographic proofs from TxLINE.
              </p>
              
              <div className="resolution-details">
                <div className="res-row">
                  <span>Target Parameter</span>
                  <span className="bold">{marketState.targetValue} goals</span>
                </div>
                <div className="res-row">
                  <span>Actual Result</span>
                  <span className="bold">{marketState.resolvedValue} goals</span>
                </div>
              </div>

              <button className="proof-btn" onClick={() => setShowProofModal(true)}>
                View Cryptographic Receipt
              </button>

              {userPosition && !userPosition.claimed && (
                <button 
                  className="claim-payout-btn"
                  onClick={handleClaim}
                  disabled={claiming}
                >
                  {claiming ? <span className="mini-spinner"></span> : 'Claim Earnings'}
                </button>
              )}

              {userPosition?.claimed && (
                <div className="claimed-badge">Payout Claimed Successfully</div>
              )}
            </div>
          ) : (
            <PredictionForm
              marketAddress={marketPda!}
              marketId={marketState.marketId.toNumber()}
              homeTeam={match?.homeTeam || 'Home'}
              awayTeam={match?.awayTeam || 'Away'}
              onSuccess={() => {
                fetchUserPosition();
              }}
            />
          )}
        </div>

        <div className="stats-column">
          <div className="pool-stats-card">
            <h3 className="stats-title">On-Chain Pool Metrics</h3>
            <div className="pool-progress-bar">
              <div className="bar-segment home" style={{ width: `${(marketState.poolSideA.toNumber() / (totalPool * 1e9 || 1)) * 100}%` }}></div>
              <div className="bar-segment draw" style={{ width: `${(marketState.poolSideDraw.toNumber() / (totalPool * 1e9 || 1)) * 100}%` }}></div>
              <div className="bar-segment away" style={{ width: `${(marketState.poolSideB.toNumber() / (totalPool * 1e9 || 1)) * 100}%` }}></div>
            </div>
            
            <div className="pool-breakdown">
              <div className="pool-stat-item">
                <span className="legend-dot home"></span>
                <span className="item-label">{match?.homeTeam || 'Home'} Win</span>
                <span className="item-val">{(marketState.poolSideA.toNumber() / 1e9).toFixed(2)} SOL</span>
              </div>
              <div className="pool-stat-item">
                <span className="legend-dot draw"></span>
                <span className="item-label">Draw / Tie</span>
                <span className="item-val">{(marketState.poolSideDraw.toNumber() / 1e9).toFixed(2)} SOL</span>
              </div>
              <div className="pool-stat-item">
                <span className="legend-dot away"></span>
                <span className="item-label">{match?.awayTeam || 'Away'} Win</span>
                <span className="item-val">{(marketState.poolSideB.toNumber() / 1e9).toFixed(2)} SOL</span>
              </div>
            </div>
            
            <div className="total-pool-row">
              <span>Total Active Pool</span>
              <span className="total-val">{totalPool.toFixed(2)} SOL</span>
            </div>
          </div>

          {userPosition && (
            <div className="user-position-card">
              <h3 className="stats-title">Your Current Position</h3>
              <div className="position-grid">
                <div className="pos-item">
                  <span className="pos-lbl">Collateral</span>
                  <span className="pos-val">{(userPosition.collateralAmount.toNumber() / 1e9).toFixed(2)} SOL</span>
                </div>
                <div className="pos-item">
                  <span className="pos-lbl">Outcome Predicted</span>
                  <span className="pos-val">
                    {userPosition.predictionVector === 0 ? 'Home win' : userPosition.predictionVector === 1 ? 'Away win' : 'Draw'}
                  </span>
                </div>
                <div className="pos-item">
                  <span className="pos-lbl">Fee Tier</span>
                  <span className="pos-val">Tier {userPosition.tierLevel}</span>
                </div>
                <div className="pos-item">
                  <span className="pos-lbl">Status</span>
                  <span className={`pos-val ${userPosition.claimed ? 'claimed' : 'active'}`}>
                    {userPosition.claimed ? 'Claimed' : 'Active'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ProofReceiptModal
        isOpen={showProofModal}
        onClose={() => setShowProofModal(false)}
        matchId={match?.id || marketIdStr}
        resolvedValue={marketState.resolvedValue}
        proofHash={Buffer.from(marketState.proofHash).toString('hex')}
        txSig=" settlement_tx_sig_from_localnet_cranker_verified_pda_logs "
      />

      <style jsx>{`
        .market-detail-page {
          display: flex;
          flex-direction: column;
          gap: 2rem;
        }

        .header-breadcrumbs {
          display: flex;
          gap: 0.5rem;
          font-size: 0.75rem;
          color: #64748b;
          font-weight: 500;
          margin-bottom: 0.5rem;
        }

        .breadcrumb-link {
          cursor: pointer;
        }

        .breadcrumb-active {
          color: #475569;
        }

        .match-status-row {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-top: 0.5rem;
        }

        .status-badge {
          font-size: 0.75rem;
          font-weight: 700;
          padding: 0.25rem 0.6rem;
          border-radius: 9999px;
          text-transform: uppercase;
        }

        .status-badge.live {
          background: rgba(239, 68, 68, 0.1);
          color: #dc2626;
          border: 1px solid rgba(239, 68, 68, 0.2);
        }

        .status-badge.finished {
          background: rgba(16, 185, 129, 0.1);
          color: #059669;
          border: 1px solid rgba(16, 185, 129, 0.2);
        }

        .status-badge.scheduled {
          background: rgba(99, 102, 241, 0.1);
          color: #4f46e5;
          border: 1px solid rgba(99, 102, 241, 0.2);
        }

        .status-score {
          font-size: 1.15rem;
          font-weight: 700;
          color: #0f172a;
          font-family: monospace;
        }

        .detail-layout {
          display: grid;
          grid-template-columns: 1fr;
          gap: 2rem;
        }

        @media (min-width: 769px) {
          .detail-layout {
            grid-template-columns: 1fr 1fr;
          }
        }

        .resolved-status-card {
          background: #ffffff;
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 20px;
          padding: 2rem;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 1.25rem;
        }

        .resolved-icon {
          color: #059669;
        }

        .resolved-title {
          font-size: 1.25rem;
          font-weight: 700;
          color: #0f172a;
        }

        .resolved-desc {
          font-size: 0.85rem;
          color: #475569;
          line-height: 1.5;
        }

        .resolution-details {
          width: 100%;
          background: rgba(15, 23, 42, 0.02);
          border-radius: 12px;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .res-row {
          display: flex;
          justify-content: space-between;
          font-size: 0.8rem;
          color: #64748b;
        }

        .res-row .bold {
          color: #0f172a;
          font-weight: 700;
        }

        .proof-btn, .claim-payout-btn {
          width: 100%;
          padding: 0.85rem;
          border-radius: 12px;
          font-size: 0.9rem;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .proof-btn {
          background: rgba(15, 23, 42, 0.05);
          border: 1px solid rgba(15, 23, 42, 0.1);
          color: #475569;
        }

        .proof-btn:hover {
          background: rgba(15, 23, 42, 0.1);
          color: #0f172a;
        }

        .claim-payout-btn {
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          border: none;
          color: #ffffff;
          box-shadow: 0 4px 15px rgba(16, 185, 129, 0.2);
        }

        .claim-payout-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(16, 185, 129, 0.3);
        }

        .claimed-badge {
          background: rgba(16, 185, 129, 0.1);
          border: 1px solid rgba(16, 185, 129, 0.2);
          color: #059669;
          font-weight: 700;
          padding: 0.75rem;
          border-radius: 12px;
          width: 100%;
        }

        .pool-stats-card, .user-position-card {
          background: #ffffff;
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 20px;
          padding: 1.5rem;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }

        .stats-title {
          font-size: 1.05rem;
          font-weight: 700;
          color: #0f172a;
        }

        .pool-progress-bar {
          height: 8px;
          background: rgba(15, 23, 42, 0.05);
          border-radius: 9999px;
          overflow: hidden;
          display: flex;
        }

        .bar-segment {
          height: 100%;
        }

        .bar-segment.home { background-color: #6366f1; }
        .bar-segment.draw { background-color: #64748b; }
        .bar-segment.away { background-color: #0ea5e9; }

        .pool-breakdown {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .pool-stat-item {
          display: flex;
          align-items: center;
          font-size: 0.85rem;
        }

        .legend-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-right: 0.75rem;
        }

        .legend-dot.home { background-color: #6366f1; }
        .legend-dot.draw { background-color: #64748b; }
        .legend-dot.away { background-color: #0ea5e9; }

        .item-label {
          color: #64748b;
          flex: 1;
        }

        .item-val {
          color: #0f172a;
          font-weight: 600;
        }

        .total-pool-row {
          border-top: 1px solid rgba(15, 23, 42, 0.08);
          padding-top: 1rem;
          display: flex;
          justify-content: space-between;
          font-size: 0.95rem;
          color: #0f172a;
          font-weight: 700;
        }

        .total-val {
          color: #4f46e5;
        }

        .position-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }

        .pos-item {
          background: rgba(15, 23, 42, 0.02);
          padding: 0.85rem;
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }

        .pos-lbl {
          font-size: 0.7rem;
          color: #64748b;
          text-transform: uppercase;
        }

        .pos-val {
          font-size: 0.9rem;
          font-weight: 700;
          color: #0f172a;
        }

        .pos-val.active { color: #4f46e5; }
        .pos-val.claimed { color: #059669; }

        .market-loading-wrapper {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1rem;
          padding: 8rem 0;
          color: #64748b;
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
