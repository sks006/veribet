import React from 'react';
import { ShieldCheck, X, Cpu, Globe, ExternalLink, BookmarkCheck } from 'lucide-react';

interface ProofReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  matchId: string;
  resolvedValue: number;
  proofHash: string;
  txSig: string;
}

export function ProofReceiptModal({
  isOpen,
  onClose,
  matchId,
  resolvedValue,
  proofHash,
  txSig
}: ProofReceiptModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="header-title-wrapper">
            <ShieldCheck className="header-icon" size={22} />
            <h3 className="modal-title">TxLINE Cryptographic Proof</h3>
          </div>
          <button className="close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="status-banner">
            <div className="status-glow"></div>
            <BookmarkCheck size={28} className="text-emerald-400" />
            <div className="status-text-wrapper">
              <span className="status-title">On-Chain Verified</span>
              <span className="status-desc">Match outcome verified by Solana VM Sealevel Layer</span>
            </div>
          </div>

          <div className="details-card">
            <div className="detail-item">
              <span className="detail-label">Match Identifier</span>
              <span className="detail-value mono">{matchId}</span>
            </div>
            
            <div className="detail-item">
              <span className="detail-label">Resolved Outcome Score</span>
              <span className="detail-value bold text-emerald-400">{resolvedValue} Goals / Points</span>
            </div>

            <div className="detail-item">
              <span className="detail-label">Cryptographic Proof Hash (SHA-256)</span>
              <span className="detail-value mono break-all text-xs">{proofHash}</span>
            </div>

            <div className="detail-item">
              <span className="detail-label">Solana Settlement Transaction</span>
              <a 
                href={`https://explorer.solana.com/tx/${txSig}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`}
                target="_blank" 
                rel="noreferrer"
                className="detail-value link"
              >
                {txSig.slice(0, 12)}...{txSig.slice(-12)} <ExternalLink size={12} />
              </a>
            </div>
          </div>

          <div className="oracle-trust-info">
            <Cpu size={16} className="text-indigo-400 shrink-0" />
            <p className="trust-text">
              Outcome verified by TxLINE decentralized crank node. Proof payload is hashed, signed, and validated in on-chain SVM contract instructions.
            </p>
          </div>
        </div>

        <div className="modal-footer">
          <button className="done-btn" onClick={onClose}>Dismiss Receipt</button>
        </div>
      </div>

      <style jsx>{`
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(15, 23, 42, 0.75);
          backdrop-filter: blur(8px);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 1000;
        }

        .modal-content {
          background: rgba(30, 41, 59, 0.9);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 24px;
          width: 100%;
          max-width: 520px;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5), 0 0 40px rgba(99, 102, 241, 0.05);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          margin: 1rem;
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1.25rem 1.5rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }

        .header-title-wrapper {
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }

        .header-icon {
          color: #10b981;
        }

        .modal-title {
          font-size: 1.15rem;
          font-weight: 700;
          color: #f8fafc;
        }

        .close-btn {
          background: none;
          border: none;
          color: #64748b;
          cursor: pointer;
          transition: color 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: 50%;
        }

        .close-btn:hover {
          color: #f8fafc;
          background: rgba(255, 255, 255, 0.05);
        }

        .modal-body {
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }

        .status-banner {
          position: relative;
          background: rgba(16, 185, 129, 0.06);
          border: 1px solid rgba(16, 185, 129, 0.15);
          border-radius: 16px;
          padding: 1rem 1.25rem;
          display: flex;
          align-items: center;
          gap: 1rem;
          overflow: hidden;
        }

        .status-glow {
          position: absolute;
          top: -20px;
          left: -20px;
          width: 80px;
          height: 80px;
          background: radial-gradient(circle, rgba(16, 185, 129, 0.2) 0%, rgba(16, 185, 129, 0) 70%);
          pointer-events: none;
        }

        .status-text-wrapper {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }

        .status-title {
          font-size: 0.95rem;
          font-weight: 700;
          color: #10b981;
        }

        .status-desc {
          font-size: 0.75rem;
          color: #94a3b8;
        }

        .details-card {
          background: rgba(15, 23, 42, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.03);
          border-radius: 16px;
          padding: 1.25rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .detail-item {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .detail-label {
          font-size: 0.7rem;
          font-weight: 600;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .detail-value {
          font-size: 0.9rem;
          color: #e2e8f0;
        }

        .detail-value.mono {
          font-family: monospace;
          color: #38bdf8;
        }

        .detail-value.link {
          color: #6366f1;
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          text-decoration: none;
          font-weight: 600;
        }

        .detail-value.link:hover {
          text-decoration: underline;
        }

        .oracle-trust-info {
          display: flex;
          gap: 0.65rem;
          background: rgba(99, 102, 241, 0.04);
          border: 1px solid rgba(99, 102, 241, 0.08);
          padding: 0.85rem;
          border-radius: 12px;
        }

        .trust-text {
          font-size: 0.75rem;
          color: #94a3b8;
          line-height: 1.4;
        }

        .modal-footer {
          padding: 1.25rem 1.5rem;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          display: flex;
          justify-content: flex-end;
        }

        .done-btn {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #f8fafc;
          padding: 0.6rem 1.2rem;
          border-radius: 10px;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .done-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.15);
        }
      `}</style>
    </div>
  );
}
