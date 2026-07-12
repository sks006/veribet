import React, { useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useProgram } from '../../hooks/useProgram';
import { placePositionWithDelegation } from '../../lib/solana';
import { PublicKey } from '@solana/web3.js';
import { Info, ShieldAlert, Sparkles, Coins } from 'lucide-react';

interface PredictionFormProps {
  marketAddress: PublicKey;
  marketId: number;
  homeTeam: string;
  awayTeam: string;
  onSuccess?: (txSig: string) => void;
  kickoffTime?: number;
  status?: string;
  statusId?: number;
}

export function PredictionForm({
  marketAddress,
  marketId,
  homeTeam,
  awayTeam,
  onSuccess,
  kickoffTime,
  status,
  statusId
}: PredictionFormProps) {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const { program } = useProgram();

  const [prediction, setPrediction] = useState<number>(0); // 0 = Home, 1 = Away, 2 = Draw
  const [collateral, setCollateral] = useState<string>('1.0');
  const [tierLevel, setTierLevel] = useState<number>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Time gating validation logic
  // Status Evaluation: If statusId evaluates to anything other than 1 (NS - Not Started), disable the submission interface
  const isStatusClosed = statusId !== undefined ? statusId !== 1 : (status ? status !== 'SCHEDULED' : false);
  
  // Temporal Evaluation: Evaluate current time against kickoffTime (startTime)
  const isTimeClosed = kickoffTime ? Date.now() >= kickoffTime : false;
  const isWindowClosed = isTimeClosed || isStatusClosed;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isWindowClosed) {
      setError('The prediction window for this market has closed (kickoff reached or match in progress).');
      return;
    }
    if (!publicKey || !signTransaction) {
      setError('Please connect your wallet first.');
      return;
    }
    if (!program) {
      setError('Anchor program not loaded.');
      return;
    }

    const collateralAmount = parseFloat(collateral);
    if (isNaN(collateralAmount) || collateralAmount <= 0) {
      setError('Please enter a valid collateral amount.');
      return;
    }

    // Convert to lamports (assuming WSOL / SOL collateral for demo)
    const lamports = collateralAmount * 1e9;
    const nonce = Math.floor(Math.random() * 1000000);

    setSubmitting(true);
    setError(null);

    try {
      console.log(`Placing position on market: ${marketAddress.toBase58()}...`);
      const txSig = await placePositionWithDelegation(
        connection,
        program,
        publicKey,
        marketAddress,
        lamports,
        prediction,
        tierLevel,
        nonce,
        signTransaction
      );

      console.log(`Position placed successfully! Signature: ${txSig}`);
      if (onSuccess) onSuccess(txSig);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Transaction failed. Check console for details.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="prediction-form" onSubmit={handleSubmit}>
      <h3 className="form-title">Place Your Position</h3>

      {isWindowClosed && (
        <div className="error-banner warning-banner">
          <ShieldAlert size={16} className="shrink-0" />
          <span>The prediction window for this market has closed (kickoff reached or match in progress).</span>
        </div>
      )}

      {/* Prediction Selection */}
      <div className="section-container">
        <label className="section-label">Select Outcome</label>
        <div className="prediction-selector">
          <button
            type="button"
            className={`select-btn ${prediction === 0 ? 'active' : ''}`}
            onClick={() => setPrediction(0)}
            disabled={isWindowClosed || submitting}
          >
            <span className="btn-team-name">{homeTeam}</span>
            <span className="btn-label">Home Win</span>
          </button>
          <button
            type="button"
            className={`select-btn ${prediction === 2 ? 'active' : ''}`}
            onClick={() => setPrediction(2)}
            disabled={isWindowClosed || submitting}
          >
            <span className="btn-team-name">Draw</span>
            <span className="btn-label">Tie Game</span>
          </button>
          <button
            type="button"
            className={`select-btn ${prediction === 1 ? 'active' : ''}`}
            onClick={() => setPrediction(1)}
            disabled={isWindowClosed || submitting}
          >
            <span className="btn-team-name">{awayTeam}</span>
            <span className="btn-label">Away Win</span>
          </button>
        </div>
      </div>

      {/* Collateral Input */}
      <div className="section-container">
        <label className="section-label">Collateral Amount (SOL)</label>
        <div className="input-wrapper">
          <Coins size={16} className="input-icon" />
          <input
            type="number"
            step="0.1"
            min="0.1"
            className="collateral-input"
            value={collateral}
            onChange={(e) => setCollateral(e.target.value)}
            disabled={isWindowClosed || submitting}
            required
          />
          <span className="input-suffix">SOL</span>
        </div>
      </div>

      {/* Tier Level Selection */}
      <div className="section-container">
        <label className="section-label">Gas Rebate Fee Tier</label>
        <select
          className="tier-select"
          value={tierLevel}
          onChange={(e) => setTierLevel(parseInt(e.target.value))}
          disabled={isWindowClosed || submitting}
        >
          <option value={1}>Tier 1 (Base Rebate - 0% Boost)</option>
          <option value={2}>Tier 2 (Bronze Rebate - 10% Boost)</option>
          <option value={3}>Tier 3 (Silver Rebate - 25% Boost)</option>
          <option value={4}>Tier 4 (Gold Rebate - 50% Boost)</option>
        </select>
      </div>

      {/* Fee & Rebate Breakdown */}
      <div className="breakdown-card">
        <div className="breakdown-row">
          <span>Position Collateral</span>
          <span className="bold">{collateral} SOL</span>
        </div>
        <div className="breakdown-row">
          <span className="flex items-center gap-1">
            Gas Rebate Contribution <Info size={12} className="text-gray-400 cursor-pointer" />
          </span>
          <span className="text-green-400 bold">+0.005 SOL</span>
        </div>
        <div className="breakdown-divider"></div>
        <div className="breakdown-row total">
          <span>Total Required</span>
          <span className="total-highlight bold">
            {(parseFloat(collateral || '0') + 0.005).toFixed(3)} SOL
          </span>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <ShieldAlert size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        className="submit-btn"
        disabled={isWindowClosed || submitting || !publicKey}
      >
        {submitting ? (
          <span className="loading-spinner"></span>
        ) : isWindowClosed ? (
          <span className="flex items-center gap-2 justify-center">
            Prediction Window Closed <ShieldAlert size={16} />
          </span>
        ) : (
          <span className="flex items-center gap-2 justify-center">
            Confirm Prediction <Sparkles size={16} />
          </span>
        )}
      </button>

      {!publicKey && (
        <p className="hint-text">Connect your wallet to predict outcomes.</p>
      )}

      <style jsx>{`
        .prediction-form {
          background: #ffffff;
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 20px;
          padding: 1.5rem;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .form-title {
          font-size: 1.15rem;
          font-weight: 700;
          color: #0f172a;
          letter-spacing: -0.02em;
        }

        .section-container {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .section-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .prediction-selector {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 0.6rem;
        }

        .select-btn {
          background: rgba(15, 23, 42, 0.02);
          border: 1px solid rgba(15, 23, 42, 0.04);
          border-radius: 12px;
          padding: 0.75rem 0.5rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.2rem;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .select-btn:hover {
          background: rgba(9, 9, 11, 0.04);
          border-color: rgba(9, 9, 11, 0.1);
        }

        .select-btn.active {
          background: #09090b;
          border-color: #09090b;
        }

        .select-btn.active .btn-team-name {
          color: #ffffff;
        }

        .select-btn.active .btn-label {
          color: rgba(255, 255, 255, 0.7);
        }

        .input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .input-icon {
          position: absolute;
          left: 1rem;
          color: #64748b;
        }

        .collateral-input {
          width: 100%;
          background: rgba(15, 23, 42, 0.02);
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 12px;
          padding: 0.85rem 1rem 0.85rem 2.5rem;
          color: #0f172a;
          font-size: 1rem;
          font-weight: 600;
          outline: none;
          transition: all 0.2s ease;
        }

        .collateral-input:focus {
          border-color: #09090b;
          box-shadow: 0 0 0 2px rgba(9, 9, 11, 0.05);
        }

        .input-suffix {
          position: absolute;
          right: 1rem;
          font-size: 0.85rem;
          font-weight: 700;
          color: #64748b;
        }

        .tier-select {
          background: rgba(15, 23, 42, 0.02);
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 12px;
          padding: 0.85rem 1rem;
          color: #0f172a;
          font-size: 0.9rem;
          outline: none;
          cursor: pointer;
        }

        .tier-select:focus {
          border-color: #09090b;
        }

        .breakdown-card {
          background: rgba(15, 23, 42, 0.02);
          border: 1px solid rgba(15, 23, 42, 0.04);
          border-radius: 14px;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }

        .breakdown-row {
          display: flex;
          justify-content: space-between;
          font-size: 0.8rem;
          color: #64748b;
        }

        .breakdown-row.total {
          font-size: 0.9rem;
          color: #0f172a;
        }

        .breakdown-divider {
          height: 1px;
          background: rgba(15, 23, 42, 0.08);
          margin: 0.2rem 0;
        }

        .bold {
          font-weight: 700;
        }

        .error-banner {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          color: #b91c1c;
          padding: 0.75rem 1rem;
          border-radius: 12px;
          font-size: 0.8rem;
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }

        .warning-banner {
          background: rgba(245, 158, 11, 0.1);
          border: 1px solid rgba(245, 158, 11, 0.2);
          color: #d97706;
        }

        .select-btn:disabled, .collateral-input:disabled, .tier-select:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          pointer-events: none;
        }

        .total-highlight {
          color: #09090b;
        }

        .submit-btn {
          background: #09090b;
          border: 1px solid #09090b;
          color: #ffffff;
          font-size: 0.95rem;
          font-weight: 700;
          padding: 0.95rem;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .submit-btn:hover:not(:disabled) {
          background: #18181b;
          border-color: #18181b;
        }

        .submit-btn:disabled {
          background: rgba(255, 255, 255, 0.05);
          color: #64748b;
          cursor: not-allowed;
          box-shadow: none;
        }

        .hint-text {
          font-size: 0.75rem;
          color: #64748b;
          text-align: center;
          margin-top: -0.5rem;
        }

        .loading-spinner {
          display: inline-block;
          width: 20px;
          height: 20px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-radius: 50%;
          border-top-color: #ffffff;
          animation: spin 0.8s ease-in-out infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </form>
  );
}
