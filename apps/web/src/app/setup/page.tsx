'use client';

import React, { useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import { ExternalLink, CheckCircle, AlertCircle, RefreshCw, Cpu, ShieldCheck, Key, Save, Award } from 'lucide-react';
import txoracleIdl from '../../lib/txoracle.json';

const TXLINE_DEVNET_PROGRAM_ID = new PublicKey('6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J');
const TXLINE_DEVNET_MINT = new PublicKey('4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

export default function SetupPage() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, signMessage } = useWallet();

  const [step, setStep] = useState(1);
  const [jwt, setJwt] = useState('');
  const [txSig, setTxSig] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [serviceLevel, setServiceLevel] = useState(1); // 1 = Free tier 60s delay, 12 = Free tier real-time
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // 1. Get Guest JWT
  const startGuestSession = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('https://txline-dev.txodds.com/auth/guest/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        throw new Error(`Failed to start session: ${res.statusText}`);
      }
      const data = await res.json();
      const token = data.token || data.jwt;
      if (!token) {
        throw new Error('No JWT token returned from guest endpoint.');
      }
      setJwt(token);
      setSuccessMsg('Guest JWT obtained successfully.');
      setStep(2);
    } catch (err: any) {
      setError(err.message || 'Error obtaining guest JWT');
    } finally {
      setLoading(false);
    }
  };

  // 2. Subscribe On-Chain
  const executeSubscription = async () => {
    if (!publicKey) {
      setError('Please connect your wallet first.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      // Derive PDAs
      const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('token_treasury_v2')],
        TXLINE_DEVNET_PROGRAM_ID
      );
      const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('pricing_matrix')],
        TXLINE_DEVNET_PROGRAM_ID
      );

      const tokenTreasuryVault = await getAssociatedTokenAddress(
        TXLINE_DEVNET_MINT,
        tokenTreasuryPda,
        true,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const userTokenAccount = await getAssociatedTokenAddress(
        TXLINE_DEVNET_MINT,
        publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const tx = new Transaction();

      // Check if user's ATA exists
      const ataInfo = await connection.getAccountInfo(userTokenAccount);
      if (!ataInfo) {
        tx.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            userTokenAccount,
            publicKey,
            TXLINE_DEVNET_MINT,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
      }

      // Initialize Anchor Program instance
      const txProgram = new anchor.Program(txoracleIdl as any, { connection } as any) as any;

      // Build subscribe instruction
      const weeks = 4; // 28 days default
      const subscribeInstruction = await txProgram.methods
        .subscribe(serviceLevel, weeks)
        .accounts({
          user: publicKey,
          pricingMatrix: pricingMatrixPda,
          tokenMint: TXLINE_DEVNET_MINT,
          userTokenAccount,
          tokenTreasuryVault,
          tokenTreasuryPda,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .instruction();

      tx.add(subscribeInstruction);

      // Send transaction
      const signature = await sendTransaction(tx, connection);
      console.log('On-chain subscription signature:', signature);

      // Wait for confirmation
      setSuccessMsg('Waiting for transaction confirmation...');
      const latestBlockhash = await connection.getLatestBlockhash();
      await connection.confirmTransaction({
        signature,
        ...latestBlockhash
      }, 'confirmed');

      setTxSig(signature);
      setSuccessMsg('On-chain subscription confirmed successfully!');
      setStep(3);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Transaction failed or rejected.');
    } finally {
      setLoading(false);
    }
  };

  // 3. Sign Message & Activate API Token
  const activateApiToken = async () => {
    if (!signMessage) {
      setError('Your wallet does not support message signing.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      // Message string: txSig::jwt
      const messageString = `${txSig}::${jwt}`;
      const encodedMessage = new TextEncoder().encode(messageString);
      const signatureBytes = await signMessage(encodedMessage);
      const walletSignature = btoa(String.fromCharCode(...Array.from(signatureBytes)));

      // Post to activation endpoint
      const res = await fetch('https://txline-dev.txodds.com/api/token/activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwt}`
        },
        body: JSON.stringify({
          txSig,
          walletSignature,
          leagues: [1], // World Cup / International Friendlies
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Activation failed: ${res.statusText} (${errorText})`);
      }

      const data = await res.json();
      const token = data.apiToken || data.token || data.apiKey;
      if (!token) {
        throw new Error('No API token returned in activation response.');
      }

      setApiToken(token);
      setSuccessMsg('API Token activated successfully!');
      setStep(4);
    } catch (err: any) {
      setError(err.message || 'API Activation failed.');
    } finally {
      setLoading(false);
    }
  };

  // 4. Save to server configuration
  const saveTokenToServer = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/setup/save-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiToken })
      });
      if (!res.ok) {
        throw new Error('Failed to save token to server config.');
      }
      setSuccessMsg('Token successfully saved to server workspace config!');
    } catch (err: any) {
      setError(err.message || 'Failed to save token.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="setup-container">
      <div className="setup-header">
        <h1 className="setup-title">TxLINE API Integration Wizard</h1>
        <p className="setup-subtitle">
          Activate your free-tier access (World Cup & International Friendlies) to fetch cryptographic live sports data feeds.
        </p>
      </div>

      <div className="steps-progress">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className={`step-indicator ${step >= s ? 'active' : ''} ${step > s ? 'completed' : ''}`}>
            <span className="step-num">{s}</span>
            <span className="step-name">
              {s === 1 ? 'Start Session' : s === 2 ? 'Subscribe' : s === 3 ? 'Activate' : 'Save Config'}
            </span>
          </div>
        ))}
      </div>

      <div className="setup-card">
        {error && (
          <div className="error-alert">
            <AlertCircle size={20} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="success-alert">
            <CheckCircle size={20} className="shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {step === 1 && (
          <div className="step-content">
            <Cpu size={48} className="step-icon" />
            <h2>Step 1: Start Guest Session</h2>
            <p>
              Connect to the TxLINE developer backend to initiate a guest session and fetch an ephemeral JWT token.
            </p>
            <button className="wizard-btn" onClick={startGuestSession} disabled={loading}>
              {loading ? <RefreshCw className="animate-spin" size={16} /> : 'Initialize Guest Session'}
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="step-content">
            <ShieldCheck size={48} className="step-icon" />
            <h2>Step 2: On-Chain Subscription</h2>
            <p>Select your desired service delay. Free tier subscriptions require 0 TXL tokens.</p>

            <div className="tier-selector">
              <label className={`tier-card ${serviceLevel === 1 ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="serviceLevel"
                  checked={serviceLevel === 1}
                  onChange={() => setServiceLevel(1)}
                />
                <div className="tier-details">
                  <span className="tier-title">Service Level 1</span>
                  <span className="tier-desc">60-second delayed World Cup data (Free)</span>
                </div>
              </label>
              <label className={`tier-card ${serviceLevel === 12 ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="serviceLevel"
                  checked={serviceLevel === 12}
                  onChange={() => setServiceLevel(12)}
                />
                <div className="tier-details">
                  <span className="tier-title">Service Level 12</span>
                  <span className="tier-desc">Real-time World Cup data (Free)</span>
                </div>
              </label>
            </div>

            {!publicKey ? (
              <p className="wallet-warn">Please connect your Solana wallet in the navbar header to proceed.</p>
            ) : (
              <button className="wizard-btn" onClick={executeSubscription} disabled={loading}>
                {loading ? <RefreshCw className="animate-spin" size={16} /> : 'Submit On-Chain Subscription'}
              </button>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="step-content">
            <Key size={48} className="step-icon" />
            <h2>Step 3: Cryptographic Activation</h2>
            <p>
              Sign the subscription validation message to link your Solana wallet signature with the TxLINE API.
            </p>
            <div className="detail-box">
              <strong>Transaction Signature:</strong>
              <span className="mono truncate">{txSig}</span>
            </div>
            <button className="wizard-btn" onClick={activateApiToken} disabled={loading}>
              {loading ? <RefreshCw className="animate-spin" size={16} /> : 'Sign Message & Activate Token'}
            </button>
          </div>
        )}

        {step === 4 && (
          <div className="step-content">
            <Award size={48} className="step-icon" />
            <h2>Step 4: Save API Token</h2>
            <p>Your TxLINE API Token is fully activated and ready!</p>
            <div className="token-box">
              <span className="mono">{apiToken}</span>
            </div>
            <button className="wizard-btn success" onClick={saveTokenToServer} disabled={loading}>
              {loading ? <RefreshCw className="animate-spin" size={16} /> : <span className="flex-btn"><Save size={16} /> Save to Server Config</span>}
            </button>
          </div>
        )}
      </div>

      <style jsx>{`
        .setup-container {
          max-width: 680px;
          margin: 4rem auto;
          padding: 0 1rem;
        }

        .setup-header {
          text-align: center;
          margin-bottom: 3rem;
        }

        .setup-title {
          font-size: 2.2rem;
          font-weight: 800;
          color: #0f172a;
          margin-bottom: 0.75rem;
        }

        .setup-subtitle {
          color: #64748b;
          font-size: 1.05rem;
          line-height: 1.5;
        }

        .steps-progress {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2.5rem;
          position: relative;
        }

        .steps-progress::after {
          content: '';
          position: absolute;
          top: 15px;
          left: 5%;
          right: 5%;
          height: 2px;
          background: #e2e8f0;
          z-index: -1;
        }

        .step-indicator {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          background: #f8fafc;
        }

        .step-num {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: #ffffff;
          border: 2px solid #cbd5e1;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          color: #64748b;
          font-size: 0.9rem;
          transition: all 0.2s ease;
        }

        .step-name {
          font-size: 0.75rem;
          font-weight: 600;
          color: #64748b;
        }

        .step-indicator.active .step-num {
          border-color: #4f46e5;
          color: #4f46e5;
          box-shadow: 0 0 10px rgba(79, 70, 229, 0.15);
        }

        .step-indicator.completed .step-num {
          background: #4f46e5;
          border-color: #4f46e5;
          color: #ffffff;
        }

        .step-indicator.active .step-name {
          color: #4f46e5;
        }

        .setup-card {
          background: #ffffff;
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 24px;
          padding: 2.5rem;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.02);
        }

        .error-alert {
          background: #fef2f2;
          border: 1px solid #fca5a5;
          color: #b91c1c;
          border-radius: 12px;
          padding: 1rem;
          display: flex;
          gap: 0.75rem;
          align-items: center;
          font-size: 0.9rem;
          font-weight: 600;
          margin-bottom: 1.5rem;
        }

        .success-alert {
          background: #ecfdf5;
          border: 1px solid #6ee7b7;
          color: #047857;
          border-radius: 12px;
          padding: 1rem;
          display: flex;
          gap: 0.75rem;
          align-items: center;
          font-size: 0.9rem;
          font-weight: 600;
          margin-bottom: 1.5rem;
        }

        .step-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 1.25rem;
        }

        .step-content h2 {
          font-size: 1.5rem;
          font-weight: 700;
          color: #0f172a;
        }

        .step-content p {
          color: #475569;
          font-size: 0.95rem;
          line-height: 1.5;
          max-width: 480px;
        }

        .step-icon {
          color: #4f46e5;
        }

        .wizard-btn {
          background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
          border: none;
          color: #ffffff;
          font-weight: 700;
          padding: 0.85rem 2rem;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 12px rgba(79, 70, 229, 0.2);
        }

        .wizard-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(79, 70, 229, 0.3);
        }

        .wizard-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }

        .wizard-btn.success {
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
        }

        .wizard-btn.success:hover {
          box-shadow: 0 6px 16px rgba(16, 185, 129, 0.3);
        }

        .flex-btn {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .tier-selector {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          width: 100%;
          max-width: 480px;
          margin: 0.5rem 0;
        }

        .tier-card {
          background: #f8fafc;
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 16px;
          padding: 1rem 1.25rem;
          display: flex;
          align-items: center;
          gap: 1rem;
          cursor: pointer;
          transition: all 0.2s ease;
          text-align: left;
        }

        .tier-card:hover {
          border-color: rgba(99, 102, 241, 0.3);
          background: #ffffff;
        }

        .tier-card.selected {
          border-color: #4f46e5;
          background: rgba(99, 102, 241, 0.02);
        }

        .tier-details {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .tier-title {
          font-weight: 700;
          color: #0f172a;
          font-size: 0.95rem;
        }

        .tier-desc {
          font-size: 0.8rem;
          color: #64748b;
        }

        .wallet-warn {
          color: #b45309 !important;
          font-weight: 600;
          font-size: 0.85rem !important;
        }

        .detail-box {
          background: #f8fafc;
          border: 1px solid rgba(15, 23, 42, 0.06);
          border-radius: 12px;
          padding: 1rem;
          width: 100%;
          max-width: 480px;
          text-align: left;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          font-size: 0.85rem;
        }

        .token-box {
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          border-radius: 12px;
          padding: 1.25rem;
          width: 100%;
          max-width: 480px;
          word-break: break-all;
          font-size: 0.85rem;
          text-align: center;
        }

        .mono {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }
      `}</style>
    </div>
  );
}
