'use client';

import React, { useEffect, useState } from 'react';
import { useProgram } from '../../hooks/useProgram';
import { useTxLine } from '../../hooks/useTxLine';
import { ShieldCheck, Search, ExternalLink, Calendar, Database, Cpu, Eye } from 'lucide-react';
import { formatAddress } from '../../lib/utils';
import { getResolutionTxSig } from '../../lib/solana';
import { ProofReceiptModal } from '../../components/common/ProofReceiptModal';

export default function ProofVaultPage() {
  const { program, connection } = useProgram();
  const { matches } = useTxLine();
  const [resolvedMarkets, setResolvedMarkets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Proof Modal state
  const [selectedProof, setSelectedProof] = useState<{
    matchId: string;
    resolvedValue: number | string;
    proofHash: string;
    marketPubKey: string;
    isProp: boolean;
  } | null>(null);
  
  const [modalTxSig, setModalTxSig] = useState<string>('');
  const [loadingTxSig, setLoadingTxSig] = useState<boolean>(false);

  const fetchResolvedMarkets = async () => {
    if (!program) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      
      // Query both standard parametric markets and settled prop markets (lifecycle index 2)
      const [parametricAccounts, propAccounts] = await Promise.all([
        program.account.parametricMarket.all(),
        program.account.binaryPropMarket.all([
          {
            memcmp: {
              offset: 88,
              bytes: "3", // Base58 representation of 0x02 (LifecycleState::Settled)
            }
          }
        ]),
      ]);

      // Filter standard resolved parametric markets
      const resolvedParametric = parametricAccounts.filter((acc: any) => acc.account.isResolved);
      
      const combined = [
        ...resolvedParametric.map((m: any) => ({
          publicKey: m.publicKey,
          account: m.account,
          isProp: false,
        })),
        ...propAccounts.map((m: any) => ({
          publicKey: m.publicKey,
          account: m.account,
          isProp: true,
        })),
      ];

      setResolvedMarkets(combined);
    } catch (e) {
      console.error('Failed to fetch proof vault markets:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResolvedMarkets();
  }, [program]);

  const handleOpenReceipt = async (market: any, matchId: string, resolvedValueText: string | number, proofHashHex: string) => {
    setSelectedProof({
      matchId,
      resolvedValue: resolvedValueText,
      proofHash: proofHashHex,
      marketPubKey: market.publicKey.toBase58(),
      isProp: market.isProp,
    });
    setLoadingTxSig(true);
    setModalTxSig('');
    try {
      const sig = await getResolutionTxSig(connection, market.publicKey, market.isProp);
      if (sig) {
        setModalTxSig(sig);
      } else {
        setModalTxSig('Not Found on Ledger');
      }
    } catch (err) {
      setModalTxSig('Error Fetching Signature');
    } finally {
      setLoadingTxSig(false);
    }
  };

  const filtered = resolvedMarkets.filter((market: any) => {
    const matchId = market.isProp
      ? Buffer.from(market.account.matchId).toString('utf8').replace(/\0/g, '')
      : Buffer.from(market.account.matchIdBytes).toString('utf8').replace(/\0/g, '');
    
    // Exclude Friendlies matches from prediction pages
    const match = matches.find(m => m.id === matchId);
    if (match) {
      const isFriendly = match.sport?.toLowerCase().includes('friendlies') || match.sport?.toLowerCase().includes('friendly');
      if (isFriendly) return false;
    } else {
      if (["18143850", "18182808", "18182864"].includes(matchId)) {
        return false;
      }
    }

    const proofHashHex = market.isProp
      ? Buffer.from(market.account.cryptographicProof).toString('hex')
      : Buffer.from(market.account.proofHash).toString('hex');
      
    return matchId.toLowerCase().includes(search.toLowerCase()) || proofHashHex.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="proof-vault-page">
      <div>
        <h1 className="page-title">Cryptographic Proof Vault</h1>
        <p className="page-subtitle">Auditable record of all matches resolved on-chain using TxLINE cryptographic signatures</p>
      </div>

      <div className="search-bar-wrapper">
        <Search className="search-icon" size={16} />
        <input
          type="text"
          placeholder="Search by match ID or proof hash..."
          className="search-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="loading-state">
          <span className="spinner"></span>
          <p>Loading proof verification records from Solana ledger...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <Database size={32} className="mb-2" />
          <p>No proof records found matching "{search}"</p>
        </div>
      ) : (
        <div className="proofs-list">
          {filtered.map((market: any, idx: number) => {
            const matchId = market.isProp
              ? Buffer.from(market.account.matchId).toString('utf8').replace(/\0/g, '')
              : Buffer.from(market.account.matchIdBytes).toString('utf8').replace(/\0/g, '');
            const proofHashHex = market.isProp
              ? Buffer.from(market.account.cryptographicProof).toString('hex')
              : Buffer.from(market.account.proofHash).toString('hex');
            
            const displayTitle = market.isProp 
              ? (market.account.displayTitle || "Binary Prop")
              : `Parametric Target: ${market.account.targetValue} units`;
              
            const resolvedValueText = market.isProp
              ? (market.account.resolvedValue?.yes ? "YES" : (market.account.resolvedValue?.no ? "NO" : (market.account.resolvedValue ? "YES" : "NO")))
              : `${market.account.resolvedValue} units`;

            const rebateSol = market.isProp
              ? (market.account.crankGasRebatePool.toNumber() / 1e9).toFixed(3)
              : ((market.account.totalFeesCollected.toNumber() || 5000000) / 1e9).toFixed(3);

            return (
              <div key={market.publicKey.toBase58()} className="proof-item-card">
                <div className="proof-item-header">
                  <div className="match-identity">
                    <span className="match-id-badge">{matchId}</span>
                    <span className="verified-stamp">
                      <ShieldCheck size={14} className="text-emerald-400" /> Verified On-Chain
                    </span>
                    {market.isProp && <span className="prop-market-badge">PROP</span>}
                  </div>
                  <span className="market-pda-text">Market PDA: {formatAddress(market.publicKey.toBase58())}</span>
                </div>

                <div className="proof-item-body">
                  <div className="proof-details-grid">
                    <div className="grid-item span-2">
                      <span className="grid-lbl">Prediction Parameter</span>
                      <span className="grid-val bold text-slate-800">{displayTitle}</span>
                    </div>
                    <div className="grid-item">
                      <span className="grid-lbl">Resolved Value</span>
                      <span className="grid-val text-emerald-500 bold">{resolvedValueText}</span>
                    </div>
                    <div className="grid-item span-2">
                      <span className="grid-lbl">SHA-256 Proof Signature</span>
                      <span className="grid-val mono break-all">{proofHashHex}</span>
                    </div>
                  </div>
                </div>

                <div className="proof-item-footer">
                  <div className="footer-stat">
                    <Cpu size={12} className="text-indigo-400" />
                    <span>Crank Gas Rebates Paid: {rebateSol} SOL</span>
                  </div>
                  <div className="actions-row">
                    <button 
                      onClick={() => handleOpenReceipt(market, matchId, resolvedValueText, proofHashHex)}
                      className="receipt-btn"
                    >
                      <Eye size={12} /> Inspect Proof
                    </button>
                    <a 
                      href={`https://explorer.solana.com/address/${market.publicKey.toBase58()}?cluster=devnet`}
                      target="_blank" 
                      rel="noreferrer"
                      className="audit-link"
                    >
                      Audit Ledger <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedProof && (
        <ProofReceiptModal
          isOpen={!!selectedProof}
          onClose={() => setSelectedProof(null)}
          matchId={selectedProof.matchId}
          resolvedValue={
            typeof selectedProof.resolvedValue === 'number' 
              ? selectedProof.resolvedValue 
              : (selectedProof.resolvedValue.toString().includes('YES') ? 1 : 0)
          }
          proofHash={selectedProof.proofHash}
          txSig={loadingTxSig ? 'Fetching...' : modalTxSig}
        />
      )}

      <style jsx>{`
        .proof-vault-page {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
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

        .proofs-list {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }

        .proof-item-card {
          background: #ffffff;
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 16px;
          padding: 1.25rem;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
          display: flex;
          flex-direction: column;
          gap: 1rem;
          transition: all 0.2s ease;
        }

        .proof-item-card:hover {
          border-color: rgba(9, 9, 11, 0.2);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
        }

        .proof-item-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 0.5rem;
          border-bottom: 1px solid rgba(15, 23, 42, 0.08);
          padding-bottom: 0.75rem;
        }

        .match-identity {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .match-id-badge {
          background: rgba(15, 23, 42, 0.04);
          border: 1px solid rgba(15, 23, 42, 0.08);
          color: #475569;
          font-size: 0.75rem;
          font-weight: 700;
          padding: 0.2rem 0.5rem;
          border-radius: 6px;
          font-family: monospace;
        }

        .verified-stamp {
          display: flex;
          align-items: center;
          gap: 0.3rem;
          font-size: 0.75rem;
          font-weight: 600;
          color: #059669;
        }

        .prop-market-badge {
          background: rgba(99, 102, 241, 0.1);
          border: 1px solid rgba(99, 102, 241, 0.2);
          color: #4f46e5;
          font-size: 0.65rem;
          font-weight: 700;
          padding: 0.15rem 0.4rem;
          border-radius: 4px;
        }

        .market-pda-text {
          font-size: 0.75rem;
          color: #64748b;
          font-family: monospace;
        }

        .proof-item-body {
          padding: 0.25rem 0;
        }

        .proof-details-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1rem;
        }

        @media (min-width: 769px) {
          .proof-details-grid {
            grid-template-columns: repeat(4, 1fr);
          }
          .grid-item.span-2 {
            grid-column: span 2;
          }
        }

        .grid-item {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }

        .grid-item.span-2 {
          grid-column: span 2;
        }

        .grid-lbl {
          font-size: 0.65rem;
          font-weight: 600;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .grid-val {
          font-size: 0.85rem;
          color: #0f172a;
        }

        .grid-val.mono {
          font-family: monospace;
          color: #09090b;
        }

        .grid-val.bold {
          font-weight: 700;
        }

        .proof-item-footer {
          border-top: 1px solid rgba(15, 23, 42, 0.08);
          padding-top: 0.75rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.75rem;
          color: #64748b;
        }

        .footer-stat {
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }

        .actions-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .receipt-btn {
          background: #09090b;
          border: 1px solid #09090b;
          color: #ffffff;
          padding: 0.35rem 0.75rem;
          border-radius: 8px;
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          gap: 0.25rem;
        }

        .receipt-btn:hover {
          background: #27272a;
          border-color: #27272a;
        }

        .audit-link {
          color: #09090b;
          display: flex;
          align-items: center;
          gap: 0.25rem;
          text-decoration: underline;
          font-weight: 600;
        }

        .audit-link:hover {
          text-decoration: underline;
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

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
