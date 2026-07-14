'use client';

import React, { use, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import * as anchor from '@coral-xyz/anchor';
import { useProgram } from '../../../hooks/useProgram';
import { useTxLine } from '../../../hooks/useTxLine';
import { useAccountSubscription } from '../../../hooks/useAccountSubscription';
import { getMarketPda, getUserPositionPda, getVaultPda, createPropMarket, placePropBet, claimPropPayout, getResolutionTxSig, getExplorerUrl } from '../../../lib/solana';
import { config } from '../../../lib/config';
import { PredictionForm } from '../../../components/market/PredictionForm';
import { ProofReceiptModal } from '../../../components/common/ProofReceiptModal';
import { RecentBetsFeed } from '../../../components/market/RecentBetsFeed';
import { TopPredictors } from '../../../components/market/TopPredictors';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { ShieldCheck, Info, User, DollarSign, Calendar, TrendingUp, ExternalLink } from 'lucide-react';

interface PageProps {
  params: Promise<{ marketId: string }>;
}

export default function MarketDetailPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const marketIdStr = resolvedParams.marketId;
  const { matches } = useTxLine();
  const { program, connection } = useProgram();
  const { publicKey, signTransaction } = useWallet();
  const router = useRouter();

  const [resolvingMarket, setResolvingMarket] = useState(true);
  const [resolvedMarketId, setResolvedMarketId] = useState<number | null>(null);
  const [onChainExists, setOnChainExists] = useState<boolean | null>(null);
  const [creatingMarket, setCreatingMarket] = useState(false);

  const [marketPda, setMarketPda] = useState<PublicKey | null>(null);
  const [userPositionPda, setUserPositionPda] = useState<PublicKey | null>(null);
  const [userPosition, setUserPosition] = useState<any | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [showProofModal, setShowProofModal] = useState(false);
  const [resolutionTxSig, setResolutionTxSig] = useState<string | null>(null);
  const [propResolutionSigs, setPropResolutionSigs] = useState<Record<string, string>>({});

  // Prop Markets State
  const [propMarkets, setPropMarkets] = useState<any[]>([]);
  const [fetchingProps, setFetchingProps] = useState(false);
  const [userPropPositions, setUserPropPositions] = useState<Record<string, any>>({});
  const [betAmounts, setBetAmounts] = useState<Record<string, string>>({});
  const [bettingProp, setBettingProp] = useState<Record<string, boolean>>({});

  // Prop Creation State
  const [showCreateProp, setShowCreateProp] = useState(false);
  const [propEventType, setPropEventType] = useState(0); // 0=Fouls, 1=RedCards, 2=YellowCards, 3=Corners, 4=FreeKicks
  const [propTeam, setPropTeam] = useState(0); // 0=Home, 1=Away
  const [propComparator, setPropComparator] = useState(0); // 0=CountGte, 1=CountLte, 2=Occurs
  const [propThreshold, setPropThreshold] = useState(5);
  const [propWindow, setPropWindow] = useState(2); // 0=FirstHalf, 1=SecondHalf, 2=FullMatch
  const [propTitle, setPropTitle] = useState('');
  const [creatingProp, setCreatingProp] = useState(false);

  // Recent Bets & Top Predictors Feed State
  const [bets, setBets] = useState<any[]>([]);
  const [betsLoading, setBetsLoading] = useState(true);

  // Resolve whether the current marketIdStr corresponds to an on-chain marketId or matchId
  useEffect(() => {
    if (!program) {
      setResolvingMarket(false);
      return;
    }
    
    let active = true;
    const resolveMarket = async () => {
      try {
        setResolvingMarket(true);
        const accounts = await program.account.parametricMarket.all();
        
        // 1. Try matching by marketId (number)
        const matchByMarketId = accounts.find(
          (acc: any) => acc.account.marketId.toString() === marketIdStr
        );
        if (matchByMarketId) {
          if (active) {
            setResolvedMarketId(matchByMarketId.account.marketId.toNumber());
            setOnChainExists(true);
            setResolvingMarket(false);
          }
          return;
        }

        // 2. Try matching by matchId (from matchIdBytes)
        const matchByMatchId = accounts.find((acc: any) => {
          const mId = Buffer.from(acc.account.matchIdBytes)
            .toString('utf8')
            .replace(/\0/g, '');
          return mId === marketIdStr;
        });

        if (matchByMatchId) {
          const actualMarketId = matchByMatchId.account.marketId.toNumber();
          if (active) {
            setResolvedMarketId(actualMarketId);
            setOnChainExists(true);
            setResolvingMarket(false);
            router.replace(`/market/${actualMarketId}`);
          }
        } else {
          // No market exists on-chain yet for either marketId or matchId
          if (active) {
            setOnChainExists(false);
            setResolvingMarket(false);
          }
        }
      } catch (err) {
        console.error('[MarketDetailPage] Error resolving market on-chain status:', err);
        if (active) {
          setOnChainExists(false);
          setResolvingMarket(false);
        }
      }
    };

    resolveMarket();

    return () => {
      active = false;
    };
  }, [marketIdStr, program, router]);

  // Derive PDAs only after we have a resolved market ID
  useEffect(() => {
    if (resolvedMarketId !== null) {
      const pda = getMarketPda(resolvedMarketId);
      setMarketPda(pda);
      if (publicKey) {
        setUserPositionPda(getUserPositionPda(pda, publicKey));
      }
    } else {
      setMarketPda(null);
      setUserPositionPda(null);
    }
  }, [resolvedMarketId, publicKey]);

  // Load account subscription for market changes
  const { marketState, loading: marketLoading } = useAccountSubscription(
    connection,
    marketPda,
    program
  );

  useEffect(() => {
    if (marketState?.isResolved && marketPda && connection) {
      const fetchResolutionTx = async () => {
        try {
          const sig = await getResolutionTxSig(connection, marketPda, false);
          if (sig) {
            setResolutionTxSig(sig);
          }
        } catch (e) {
          console.error('[MarketDetailPage] Error fetching resolution tx signature:', e);
        }
      };
      fetchResolutionTx();
    }
  }, [marketState?.isResolved, marketPda, connection]);

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

  // Fetch Prop Markets
  const fetchPropMarkets = async () => {
    if (!program) return;
    try {
      setFetchingProps(true);
      const allPropMarkets = await program.account.binaryPropMarket.all();
      const matched = allPropMarkets.filter((m: any) => {
        const mIdStr = Buffer.from(m.account.matchId).toString('utf8').replace(/\0/g, '');
        return mIdStr === marketIdStr;
      });
      setPropMarkets(matched);
      await fetchUserPropPositions(matched);
    } catch (err) {
      console.error('Error fetching prop markets:', err);
    } finally {
      setFetchingProps(false);
    }
  };

  const fetchUserPropPositions = async (propsList: any[]) => {
    if (!program || !publicKey) return;
    const positionsMap: Record<string, any> = {};
    for (const m of propsList) {
      const [posAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from('prop_position'), m.publicKey.toBuffer(), publicKey.toBuffer()],
        program.programId
      );
      try {
        const pos = await program.account.propPosition.fetch(posAddress);
        positionsMap[m.publicKey.toBase58()] = pos;
      } catch (e) {
        // no position
      }
    }
    setUserPropPositions(positionsMap);
  };

  useEffect(() => {
    fetchPropMarkets();
  }, [program, marketIdStr, publicKey]);

  useEffect(() => {
    if (!connection || propMarkets.length === 0) return;
    const fetchPropResolutionSigs = async () => {
      const newSigs: Record<string, string> = { ...propResolutionSigs };
      let changed = false;

      for (const m of propMarkets) {
        const keyStr = m.publicKey.toBase58();
        if (m.account.resolved && !newSigs[keyStr]) {
          try {
            const sig = await getResolutionTxSig(connection, m.publicKey, true);
            if (sig) {
              newSigs[keyStr] = sig;
              changed = true;
            }
          } catch (e) {
            console.error(`[MarketDetailPage] Error fetching prop resolution sig for ${keyStr}:`, e);
          }
        }
      }

      if (changed) {
        setPropResolutionSigs(newSigs);
      }
    };

    fetchPropResolutionSigs();
  }, [propMarkets, connection]);

  // Fetch Bets Feed
  const fetchBets = async () => {
    try {
      const res = await fetch(`/api/markets/${marketIdStr}/bets`);
      if (res.ok) {
        const data = await res.json();
        if (data.bets) {
          setBets(data.bets);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setBetsLoading(false);
    }
  };

  useEffect(() => {
    fetchBets();
    const interval = setInterval(fetchBets, 8000);
    return () => clearInterval(interval);
  }, [marketIdStr]);

  const handleCreatePropMarket = async () => {
    if (!program || !publicKey || !signTransaction) {
      alert('Please connect your wallet first.');
      return;
    }
    setCreatingProp(true);
    try {
      const eventTypes = ["Fouls", "Red Cards", "Yellow Cards", "Corners", "Free Kicks"];
      const comparators = [">=", "<=", "Occurs"];
      const eventName = eventTypes[propEventType];
      const comp = comparators[propComparator];
      const teamLabel = propTeam === 0 ? "Home" : "Away";
      const title = propTitle || `${eventName} (${teamLabel}) ${comp} ${propThreshold}`;

      const matchObj = matches.find(m => m.id === marketIdStr);
      let bettingClosesAt = matchObj ? Math.floor(matchObj.kickoffTime / 1000) : Math.floor(Date.now() / 1000) + 3600;
      
      if (propWindow === 0) {
        bettingClosesAt = (matchObj ? Math.floor(matchObj.kickoffTime / 1000) : Math.floor(Date.now() / 1000)) + 35 * 60;
      } else if (propWindow === 1) {
        bettingClosesAt = (matchObj ? Math.floor(matchObj.kickoffTime / 1000) : Math.floor(Date.now() / 1000)) + 80 * 60;
      }

      await createPropMarket(
        connection,
        program,
        publicKey,
        marketIdStr,
        propEventType,
        propTeam,
        propComparator,
        propThreshold,
        propWindow,
        title,
        bettingClosesAt,
        signTransaction
      );

      alert('Prop market created successfully!');
      setShowCreateProp(false);
      fetchPropMarkets();
      fetchBets();
    } catch (err: any) {
      console.error(err);
      alert(`Failed to create prop market: ${err.message}`);
    } finally {
      setCreatingProp(false);
    }
  };

  const handlePlacePropBet = async (marketPubKey: PublicKey, side: boolean) => {
    if (!program || !publicKey || !signTransaction) {
      alert('Please connect your wallet first.');
      return;
    }
    const marketKeyStr = marketPubKey.toBase58();
    const amountStr = betAmounts[marketKeyStr] || '1.0';
    const amountVal = parseFloat(amountStr);
    if (isNaN(amountVal) || amountVal <= 0) {
      alert('Please enter a valid amount.');
      return;
    }

    setBettingProp(prev => ({ ...prev, [marketKeyStr]: true }));
    try {
      await placePropBet(
        connection,
        program,
        publicKey,
        marketPubKey,
        side,
        amountVal,
        signTransaction
      );
      alert('Bet placed successfully!');
      fetchPropMarkets();
      fetchBets();
    } catch (err: any) {
      console.error(err);
      alert(`Failed to place bet: ${err.message}`);
    } finally {
      setBettingProp(prev => ({ ...prev, [marketKeyStr]: false }));
    }
  };

  const handleClaimPropPosition = async (marketPubKey: PublicKey) => {
    if (!program || !publicKey || !signTransaction) {
      alert('Please connect your wallet first.');
      return;
    }
    try {
      await claimPropPayout(
        connection,
        program,
        publicKey,
        marketPubKey,
        signTransaction
      );
      alert('Payout claimed successfully!');
      fetchPropMarkets();
    } catch (err: any) {
      console.error(err);
      alert(`Failed to claim payout: ${err.message}`);
    }
  };

  // Match info from TxLINE stream
  const match = matches.find(m => m.id === marketIdStr || (marketState && 
    Buffer.from(marketState.matchIdBytes).toString('utf8').replace(/\0/g, '') === m.id
  ));

  const handleCreateMarket = async () => {
    if (!program || !publicKey) {
      alert('Please connect your wallet first.');
      return;
    }

    const matchObj = matches.find(m => m.id === marketIdStr);
    if (!matchObj) {
      alert('Match details not found.');
      return;
    }

    const kickoffTimestamp = Math.floor(matchObj.kickoffTime / 1000);
    const nowSecs = Math.floor(Date.now() / 1000);
    if (kickoffTimestamp <= nowSecs) {
      alert('Cannot initialize a prediction market for a match that has already kicked off.');
      return;
    }

    setCreatingMarket(true);
    try {
      const marketId = Math.floor(Math.random() * 10000000);
      const marketPda = getMarketPda(marketId);
      const vaultPda = getVaultPda(marketPda);

      const matchIdBytes = Buffer.alloc(16);
      Buffer.from(marketIdStr).copy(matchIdBytes);

      // Default mock token mint (WSOL)
      const mockMint = new PublicKey('So11111111111111111111111111111111111111112');

      const sequence = 1;
      const targetValue = 2; // target value
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
      
      setResolvedMarketId(marketId);
      setOnChainExists(true);
      router.replace(`/market/${marketId}`);
    } catch (err: any) {
      console.error(err);
      alert(`Market initialization failed: ${err.message}`);
    } finally {
      setCreatingMarket(false);
    }
  };

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

  const isFriendly = match?.sport?.toLowerCase().includes('friendlies') || match?.sport?.toLowerCase().includes('friendly') || ["18143850", "18182808", "18182864"].includes(marketIdStr);
  if (isFriendly) {
    return (
      <div className="market-loading-wrapper">
        <p>No prediction market available for Friendlies matches.</p>
      </div>
    );
  }

  if (resolvingMarket) {
    return (
      <div className="market-loading-wrapper">
        <span className="spinner"></span>
        <p>Resolving market on-chain status...</p>
      </div>
    );
  }

  if (onChainExists === false) {
    const matchTitle = match ? `${match.homeTeam} vs ${match.awayTeam}` : 'Prediction Pool';
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
              {match.status !== 'SCHEDULED' && (
                <span className="status-score">{match.homeScore} - {match.awayScore}</span>
              )}
            </div>
          )}
        </div>

        <div className="no-market-container">
          <div className="no-market-card">
            <Info size={48} className="no-market-icon" />
            <h2>No Active On-Chain Pool</h2>
            <p>
              An active prediction pool has not yet been initialized on-chain for this match. 
              Initialize the prediction pool to enable live predictions and trustless settlements.
            </p>

            {publicKey ? (
              <button 
                className="init-pool-btn-large" 
                onClick={handleCreateMarket}
                disabled={creatingMarket}
              >
                {creatingMarket ? <span className="mini-spinner"></span> : 'Initialize Prediction Pool'}
              </button>
            ) : (
              <div className="wallet-warn">
                <p>Connect your wallet to initialize the prediction pool.</p>
              </div>
            )}
          </div>
        </div>

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
            background: rgba(9, 9, 11, 0.04);
            color: #09090b;
            border: 1px solid rgba(9, 9, 11, 0.1);
          }
          .status-score {
            font-size: 1.15rem;
            font-weight: 700;
            color: #0f172a;
            font-family: monospace;
          }
          .no-market-container {
            display: flex;
            justify-content: center;
            padding: 4rem 1rem;
          }
          .no-market-card {
            background: #ffffff;
            border: 1px solid rgba(15, 23, 42, 0.08);
            border-radius: 20px;
            padding: 3rem 2rem;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
            text-align: center;
            max-width: 500px;
            width: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 1.5rem;
          }
          .no-market-icon {
            color: #64748b;
          }
          .no-market-card h2 {
            font-size: 1.5rem;
            font-weight: 800;
            color: #0f172a;
          }
          .no-market-card p {
            font-size: 0.9rem;
            color: #475569;
            line-height: 1.6;
          }
          .init-pool-btn-large {
            width: 100%;
            background: #09090b;
            border: 1px solid #09090b;
            color: #ffffff;
            font-weight: 700;
            font-size: 0.95rem;
            padding: 0.85rem;
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.2s ease;
          }
          .init-pool-btn-large:hover {
            background: #18181b;
            border-color: #18181b;
            transform: translateY(-1px);
          }
          .init-pool-btn-large:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }
          .wallet-warn {
            background: rgba(245, 158, 11, 0.1);
            border: 1px solid rgba(245, 158, 11, 0.2);
            color: #d97706;
            padding: 0.75rem 1rem;
            border-radius: 10px;
            font-size: 0.85rem;
            font-weight: 600;
            width: 100%;
          }
          .mini-spinner {
            display: inline-block;
            width: 16px;
            height: 16px;
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

              {resolutionTxSig ? (
                <a 
                  className="proof-btn-link"
                  href={getExplorerUrl(resolutionTxSig, config.rpcUrl)}
                  target="_blank" 
                  rel="noreferrer"
                >
                  View Settlement Proof <ExternalLink size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                </a>
              ) : (
                <button className="proof-btn-link" disabled style={{ opacity: 0.7, cursor: 'not-allowed' }}>
                  Fetching Settlement Proof...
                </button>
              )}

              <button className="proof-btn" onClick={() => setShowProofModal(true)} style={{ marginTop: '0.5rem' }}>
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
              kickoffTime={match ? match.kickoffTime : (marketState ? marketState.kickoffTimestamp.toNumber() * 1000 : undefined)}
              status={match ? match.status : undefined}
              statusId={match ? match.statusId : undefined}
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

      {/* Prop Markets and Feed Section */}
      <div className="prop-section-divider">
        <div className="prop-section-header">
          <div>
            <h2 className="section-title">
              <TrendingUp className="section-title-icon" />
              Event-Based Prop Markets
            </h2>
            <p className="section-subtitle">Bet on live match occurrences with parimutuel pools</p>
          </div>
          <button
            onClick={() => setShowCreateProp(!showCreateProp)}
            className="btn-primary-custom"
          >
            {showCreateProp ? 'Close Form' : 'Create Custom Prop'}
          </button>
        </div>

        {/* Create Prop Form */}
        {showCreateProp && (
          <div className="prop-form-card shadow-premium">
            <h3 className="form-card-title">Create New Prop Market</h3>
            <div className="form-grid">
              <div className="form-field">
                <label className="field-label">Event Type</label>
                <select
                  value={propEventType}
                  onChange={(e) => setPropEventType(Number(e.target.value))}
                  className="form-select"
                >
                  <option value={0}>Fouls</option>
                  <option value={1}>Red Cards</option>
                  <option value={2}>Yellow Cards</option>
                  <option value={3}>Corners</option>
                  <option value={4}>Free Kicks</option>
                </select>
              </div>

              <div className="form-field">
                <label className="field-label">Team Target</label>
                <select
                  value={propTeam}
                  onChange={(e) => setPropTeam(Number(e.target.value))}
                  className="form-select"
                >
                  <option value={0}>Home Team ({match?.homeTeam || 'Home'})</option>
                  <option value={1}>Away Team ({match?.awayTeam || 'Away'})</option>
                </select>
              </div>

              <div className="form-field">
                <label className="field-label">Condition</label>
                <select
                  value={propComparator}
                  onChange={(e) => setPropComparator(Number(e.target.value))}
                  className="form-select"
                >
                  <option value={0}>Greater than or equal (&gt;=)</option>
                  <option value={1}>Less than or equal (&lt;=)</option>
                  <option value={2}>Occurs (count &gt; 0)</option>
                </select>
              </div>

              <div className="form-field">
                <label className="field-label">Threshold Value</label>
                <input
                  type="number"
                  value={propThreshold}
                  onChange={(e) => setPropThreshold(Number(e.target.value))}
                  className="form-input"
                  min={0}
                />
              </div>

              <div className="form-field">
                <label className="field-label">Prediction Window</label>
                <select
                  value={propWindow}
                  onChange={(e) => setPropWindow(Number(e.target.value))}
                  className="form-select"
                >
                  <option value={0}>First Half (Closes at minute 35)</option>
                  <option value={1}>Second Half (Closes at minute 80)</option>
                  <option value={2}>Full Match (Closes at kickoff)</option>
                </select>
              </div>

              <div className="form-field">
                <label className="field-label">Custom Display Title (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Under 3 corners in first half"
                  value={propTitle}
                  onChange={(e) => setPropTitle(e.target.value)}
                  className="form-input"
                />
              </div>
            </div>

            <button
              onClick={handleCreatePropMarket}
              disabled={creatingProp}
              className="btn-submit-prop"
            >
              {creatingProp ? <span className="spinner-inline"></span> : 'Initialize Prop Market'}
            </button>
          </div>
        )}

        <div className="prop-dashboard-layout">
          {/* Prop Markets list */}
          <div className="prop-list-column">
            {fetchingProps ? (
              <div className="prop-loading">
                <div className="spinner-inline dark"></div>
                <span>Fetching active prop markets...</span>
              </div>
            ) : propMarkets.length === 0 ? (
              <div className="prop-empty-card">
                No active prop markets for this match. Click "Create Custom Prop" to launch one!
              </div>
            ) : (
              propMarkets.map((m) => {
                const keyStr = m.publicKey.toBase58();
                const marketAcc = m.account;
                const userPos = userPropPositions[keyStr];
                
                const yesPoolSol = marketAcc.poolYes.toNumber() / 1e9;
                const noPoolSol = marketAcc.poolNo.toNumber() / 1e9;
                const totalPropPool = yesPoolSol + noPoolSol;

                return (
                  <div key={keyStr} className="prop-market-item shadow-premium">
                    <div className="prop-item-header">
                      <div>
                        <h4 className="prop-item-title">{marketAcc.displayTitle}</h4>
                        <div className="prop-item-meta">
                          <span className="prop-key-badge">
                            {keyStr.slice(0, 4)}...{keyStr.slice(-4)}
                          </span>
                          <span className="dot">•</span>
                          <span>Window: {marketAcc.window === 0 ? '1st Half' : marketAcc.window === 1 ? '2nd Half' : 'Full Match'}</span>
                        </div>
                      </div>

                      <div className="prop-status-wrapper">
                        {marketAcc.resolved ? (
                          <span className={`status-badge-custom resolved-${marketAcc.resolvedValue ? 'yes' : 'no'}`}>
                            RESOLVED: {marketAcc.resolvedValue ? 'YES' : 'NO'}
                          </span>
                        ) : !marketAcc.bettable ? (
                          <span className="status-badge-custom closed">
                            CLOSED
                          </span>
                        ) : (
                          <span className="status-badge-custom active">
                            BETTABLE
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="prop-item-grid">
                      {/* Pool Breakdown */}
                      <div className="pool-breakdown">
                        <div className="pool-row">
                          <span>YES Pool</span>
                          <span className="font-mono text-dark">{yesPoolSol.toFixed(3)} SOL</span>
                        </div>
                        <div className="pool-row">
                          <span>NO Pool</span>
                          <span className="font-mono text-dark">{noPoolSol.toFixed(3)} SOL</span>
                        </div>
                        <div className="pool-ratio-bar">
                          <div className="bar-yes" style={{ width: `${(yesPoolSol / (totalPropPool || 1)) * 100}%` }} />
                          <div className="bar-no" style={{ width: `${(noPoolSol / (totalPropPool || 1)) * 100}%` }} />
                        </div>
                      </div>

                      {/* User Position */}
                      <div className="user-position-box">
                        <div className="box-title">Your Position</div>
                        {userPos ? (
                          <div className="box-content">
                            <div className="box-row">
                              <span>Side:</span>
                              <span className={`side-val ${userPos.side ? 'yes' : 'no'}`}>
                                {userPos.side ? 'YES' : 'NO'}
                              </span>
                            </div>
                            <div className="box-row">
                              <span>Stake:</span>
                              <span className="font-mono text-dark">{(userPos.amount.toNumber() / 1e9).toFixed(3)} SOL</span>
                            </div>
                            <div className="box-row">
                              <span>Status:</span>
                              <span className={`status-val ${userPos.claimed ? 'claimed' : 'active'}`}>
                                {userPos.claimed ? 'Claimed' : 'Active'}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="box-empty">No bet placed</div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="action-box">
                        {marketAcc.resolved ? (
                          <div className="resolved-actions-wrapper">
                            {userPos && !userPos.claimed && (
                              <button
                                onClick={() => handleClaimPropPosition(m.publicKey)}
                                className="btn-claim-prop"
                              >
                                Claim Payout
                              </button>
                            )}
                            {propResolutionSigs[keyStr] ? (
                              <a 
                                href={getExplorerUrl(propResolutionSigs[keyStr], config.rpcUrl)}
                                target="_blank" 
                                rel="noreferrer"
                                className="proof-btn-link-prop"
                              >
                                View Settlement Proof <ExternalLink size={12} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                              </a>
                            ) : (
                              <span className="fetching-sig-label">
                                Fetching Settlement Proof...
                              </span>
                            )}
                          </div>
                        ) : marketAcc.bettable ? (
                          <div className="bet-form-wrapper">
                            <input
                              type="text"
                              placeholder="Amount in SOL"
                              value={betAmounts[keyStr] || ''}
                              onChange={(e) => setBetAmounts(prev => ({ ...prev, [keyStr]: e.target.value }))}
                              className="bet-amount-input"
                            />
                            <div className="bet-buttons-row">
                              <button
                                onClick={() => handlePlacePropBet(m.publicKey, true)}
                                disabled={bettingProp[keyStr]}
                                className="btn-bet-yes"
                              >
                                Bet YES
                              </button>
                              <button
                                onClick={() => handlePlacePropBet(m.publicKey, false)}
                                disabled={bettingProp[keyStr]}
                                className="btn-bet-no"
                              >
                                Bet NO
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="bet-closed-label">
                            Betting closed
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Social components */}
          <div className="social-column">
            <TopPredictors bets={bets} loading={betsLoading} />
            <RecentBetsFeed marketId={marketIdStr} />
          </div>
        </div>
      </div>

      <ProofReceiptModal
        isOpen={showProofModal}
        onClose={() => setShowProofModal(false)}
        matchId={match?.id || marketIdStr}
        resolvedValue={marketState.resolvedValue}
        proofHash={Buffer.from(marketState.proofHash).toString('hex')}
        txSig={resolutionTxSig || 'settlement_tx_sig_from_localnet_cranker_verified_pda_logs'}
      />

      <style jsx>{`
        .prop-section-divider {
          width: 100%;
          margin-top: 2.5rem;
          padding-top: 2rem;
          border-top: 1px solid rgba(15, 23, 42, 0.08);
          font-family: ui-sans-serif, system-ui, sans-serif;
        }

        .prop-section-header {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          margin-bottom: 1.5rem;
        }

        @media (min-width: 769px) {
          .prop-section-header {
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
          }
        }

        .section-title {
          font-size: 1.35rem;
          font-weight: 800;
          color: #0f172a;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin: 0;
        }

        .section-title-icon {
          color: #059669;
          width: 1.5rem;
          height: 1.5rem;
        }

        .section-subtitle {
          font-size: 0.85rem;
          color: #64748b;
          margin: 0.25rem 0 0 0;
        }

        .btn-primary-custom {
          background: #09090b;
          color: #ffffff;
          border: 1px solid #09090b;
          padding: 0.5rem 1rem;
          font-size: 0.85rem;
          font-weight: 700;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .btn-primary-custom:hover {
          background: #18181b;
          border-color: #18181b;
        }

        .prop-form-card {
          background: #ffffff;
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 20px;
          padding: 1.5rem;
          margin-bottom: 2rem;
          max-width: 48rem;
          width: 100%;
        }

        .form-card-title {
          font-size: 1.05rem;
          font-weight: 700;
          color: #0f172a;
          margin-bottom: 1rem;
        }

        .form-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1rem;
        }

        @media (min-width: 640px) {
          .form-grid {
            grid-template-columns: 1fr 1fr;
          }
        }

        .form-field {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }

        .field-label {
          font-size: 0.7rem;
          font-weight: 700;
          color: #475569;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .form-select, .form-input {
          background: rgba(15, 23, 42, 0.01);
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 8px;
          padding: 0.6rem 0.75rem;
          font-size: 0.85rem;
          color: #0f172a;
          outline: none;
          transition: all 0.2s ease;
        }

        .form-select:focus, .form-input:focus {
          border-color: rgba(15, 23, 42, 0.2);
          background: #ffffff;
        }

        .btn-submit-prop {
          margin-top: 1.5rem;
          width: 100%;
          background: #09090b;
          color: #ffffff;
          border: none;
          padding: 0.75rem;
          font-size: 0.85rem;
          font-weight: 700;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        }

        .btn-submit-prop:hover {
          background: #18181b;
        }

        .btn-submit-prop:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .prop-dashboard-layout {
          display: grid;
          grid-template-columns: 1fr;
          gap: 2rem;
        }

        @media (min-width: 1025px) {
          .prop-dashboard-layout {
            grid-template-columns: 2fr 1fr;
          }
        }

        .prop-list-column {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .social-column {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .prop-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 2.5rem;
          font-size: 0.85rem;
          color: #64748b;
        }

        .spinner-inline {
          display: inline-block;
          width: 1rem;
          height: 1rem;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: #ffffff;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        .spinner-inline.dark {
          border: 2px solid rgba(15, 23, 42, 0.1);
          border-top-color: #0f172a;
        }

        .prop-empty-card {
          border: 1px dashed rgba(15, 23, 42, 0.15);
          border-radius: 12px;
          padding: 2rem;
          text-align: center;
          color: #64748b;
          font-size: 0.85rem;
        }

        .prop-market-item {
          background: #ffffff;
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 16px;
          padding: 1.25rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .prop-item-header {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          border-bottom: 1px solid rgba(15, 23, 42, 0.05);
          padding-bottom: 0.75rem;
        }

        @media (min-width: 640px) {
          .prop-item-header {
            flex-direction: row;
            justify-content: space-between;
            align-items: flex-start;
          }
        }

        .prop-item-title {
          font-size: 0.95rem;
          font-weight: 700;
          color: #0f172a;
          margin: 0;
        }

        .prop-item-meta {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.7rem;
          color: #64748b;
          margin-top: 0.25rem;
        }

        .prop-key-badge {
          font-family: monospace;
          background: rgba(15, 23, 42, 0.04);
          border: 1px solid rgba(15, 23, 42, 0.05);
          padding: 0.05rem 0.25rem;
          border-radius: 4px;
          font-size: 0.65rem;
        }

        .dot {
          color: #cbd5e1;
        }

        .prop-status-wrapper {
          display: flex;
        }

        .status-badge-custom {
          font-size: 0.65rem;
          font-weight: 750;
          padding: 0.15rem 0.4rem;
          border-radius: 4px;
        }

        .status-badge-custom.active {
          background: rgba(16, 185, 129, 0.1);
          color: #059669;
          border: 1px solid rgba(16, 185, 129, 0.2);
        }

        .status-badge-custom.closed {
          background: rgba(15, 23, 42, 0.04);
          color: #64748b;
          border: 1px solid rgba(15, 23, 42, 0.08);
        }

        .status-badge-custom.resolved-yes {
          background: rgba(16, 185, 129, 0.1);
          color: #059669;
          border: 1px solid rgba(16, 185, 129, 0.2);
        }

        .status-badge-custom.resolved-no {
          background: rgba(239, 68, 68, 0.1);
          color: #dc2626;
          border: 1px solid rgba(239, 68, 68, 0.2);
        }

        .prop-item-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1.25rem;
          align-items: center;
        }

        @media (min-width: 769px) {
          .prop-item-grid {
            grid-template-columns: 1fr 1fr 1fr;
          }
        }

        .pool-breakdown {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }

        .pool-row {
          display: flex;
          justify-content: space-between;
          font-size: 0.75rem;
          color: #64748b;
        }

        .text-dark {
          color: #0f172a;
          font-weight: 600;
        }

        .pool-ratio-bar {
          height: 0.35rem;
          width: 100%;
          background: rgba(15, 23, 42, 0.04);
          border-radius: 9999px;
          overflow: hidden;
          display: flex;
          margin-top: 0.25rem;
        }

        .bar-yes {
          background: #10b981;
          height: 100%;
        }

        .bar-no {
          background: #ef4444;
          height: 100%;
        }

        .user-position-box {
          background: rgba(15, 23, 42, 0.01);
          border: 1px solid rgba(15, 23, 42, 0.04);
          border-radius: 8px;
          padding: 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .box-title {
          font-size: 0.65rem;
          font-weight: 700;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.2rem;
        }

        .box-content {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }

        .box-row {
          display: flex;
          justify-content: space-between;
          font-size: 0.75rem;
          color: #475569;
        }

        .side-val.yes {
          color: #059669;
          font-weight: 700;
        }

        .side-val.no {
          color: #dc2626;
          font-weight: 700;
        }

        .status-val.active {
          color: #059669;
          font-weight: 600;
        }

        .status-val.claimed {
          color: #94a3b8;
        }

        .box-empty {
          font-size: 0.75rem;
          color: #94a3b8;
          font-style: italic;
          text-align: center;
          padding: 0.25rem 0;
        }

        .action-box {
          display: flex;
          flex-direction: column;
        }

        .btn-claim-prop {
          width: 100%;
          background: #10b981;
          color: #ffffff;
          border: none;
          padding: 0.5rem;
          font-size: 0.75rem;
          font-weight: 700;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .btn-claim-prop:hover {
          background: #059669;
        }

        .resolved-actions-wrapper {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          width: 100%;
        }

        .proof-btn-link-prop {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          background: #09090b;
          color: #ffffff;
          border: 1px solid #09090b;
          padding: 0.5rem;
          font-size: 0.75rem;
          font-weight: 700;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
          text-decoration: none;
          text-align: center;
        }

        .proof-btn-link-prop:hover {
          background: #18181b;
          border-color: #18181b;
        }

        .fetching-sig-label {
          font-size: 0.75rem;
          color: #64748b;
          font-style: italic;
          text-align: center;
        }

        .bet-form-wrapper {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .bet-amount-input {
          width: 100%;
          background: #ffffff;
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 6px;
          padding: 0.4rem 0.5rem;
          font-size: 0.75rem;
          color: #0f172a;
          font-family: monospace;
          outline: none;
        }

        .bet-amount-input:focus {
          border-color: rgba(15, 23, 42, 0.2);
        }

        .bet-buttons-row {
          display: flex;
          gap: 0.5rem;
        }

        .btn-bet-yes, .btn-bet-no {
          width: 50%;
          padding: 0.4rem;
          font-size: 0.75rem;
          font-weight: 700;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .btn-bet-yes {
          background: rgba(16, 185, 129, 0.1);
          color: #059669;
          border: 1px solid rgba(16, 185, 129, 0.2);
        }

        .btn-bet-yes:hover:not(:disabled) {
          background: rgba(16, 185, 129, 0.2);
        }

        .btn-bet-no {
          background: rgba(239, 68, 68, 0.1);
          color: #dc2626;
          border: 1px solid rgba(239, 68, 68, 0.2);
        }

        .btn-bet-no:hover:not(:disabled) {
          background: rgba(239, 68, 68, 0.2);
        }

        .btn-bet-yes:disabled, .btn-bet-no:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .bet-closed-label {
          font-size: 0.75rem;
          color: #94a3b8;
          font-style: italic;
          text-align: center;
          padding: 0.5rem 0;
        }

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
          background: rgba(9, 9, 11, 0.04);
          color: #09090b;
          border: 1px solid rgba(9, 9, 11, 0.1);
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

        .proof-btn-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          padding: 0.85rem;
          border-radius: 12px;
          font-size: 0.9rem;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s ease;
          background: #09090b;
          color: #ffffff;
          border: 1px solid #09090b;
          text-decoration: none;
          text-align: center;
        }

        .proof-btn-link:hover {
          background: #18181b;
          border-color: #18181b;
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

        .bar-segment.home { background-color: #09090b; }
        .bar-segment.draw { background-color: #64748b; }
        .bar-segment.away { background-color: #71717a; }

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

        .legend-dot.home { background-color: #09090b; }
        .legend-dot.draw { background-color: #64748b; }
        .legend-dot.away { background-color: #71717a; }

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
          color: #09090b;
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

        .pos-val.active { color: #09090b; }
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
      `}</style>
    </div>
  );
}
