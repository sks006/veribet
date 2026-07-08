'use client';

import React, { useEffect, useState } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

// Import default styles
import '@solana/wallet-adapter-react-ui/styles.css';

export function WalletConnect() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!publicKey) {
      setSolBalance(null);
      setUsdcBalance(null);
      return;
    }

    let active = true;

    const fetchBalances = async () => {
      try {
        // Fetch SOL balance
        const balance = await connection.getBalance(publicKey);
        if (active) setSolBalance(balance / LAMPORTS_PER_SOL);

        // Fetch USDC balance
        const usdcMints = [
          new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), // Mainnet USDC
          new PublicKey('Gh9ZwEmdLJ8DscKNTMSSHRthPKNWGQMR1erTy2SkX8C5'), // Devnet USDC
        ];

        let foundUsdcBalance = 0;
        for (const mint of usdcMints) {
          try {
            const ata = await getAssociatedTokenAddress(mint, publicKey);
            const tokenBalance = await connection.getTokenAccountBalance(ata);
            if (tokenBalance.value.uiAmount !== null) {
              foundUsdcBalance = tokenBalance.value.uiAmount;
              break;
            }
          } catch {
            // ATA doesn't exist
          }
        }
        if (active) setUsdcBalance(foundUsdcBalance);
      } catch (err) {
        console.error('Error fetching balances:', err);
      }
    };

    fetchBalances();
    const interval = setInterval(fetchBalances, 10000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [publicKey, connection]);

  return (
    <div className="wallet-connect-container">
      {publicKey && (
        <div className="balances-pill">
          <span className="balance-item sol">
            {solBalance !== null ? `${solBalance.toFixed(3)} SOL` : '... SOL'}
          </span>
          {usdcBalance !== null && usdcBalance > 0 && (
            <>
              <span className="divider">|</span>
              <span className="balance-item usdc">
                {usdcBalance.toFixed(2)} USDC
              </span>
            </>
          )}
        </div>
      )}
      <WalletMultiButton className="custom-wallet-button" />

      <style jsx global>{`
        .wallet-connect-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
        }

        .balances-pill {
          background: rgba(99, 102, 241, 0.08);
          border: 1px solid rgba(99, 102, 241, 0.15);
          border-radius: 9999px;
          padding: 0.45rem 1rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.85rem;
          font-weight: 700;
          color: #4f46e5;
          box-shadow: 0 1px 2px rgba(99, 102, 241, 0.05);
        }

        .divider {
          color: rgba(99, 102, 241, 0.3);
          font-weight: 300;
        }

        .custom-wallet-button {
          align-items: center !important;
          appearance: button !important;
          background-color: #ffffff !important;
          border: 1px solid rgba(15, 23, 42, 0.15) !important;
          border-radius: 9999px !important;
          color: #0f172a !important;
          display: inline-flex !important;
          font-family: inter, "inter Fallback", sans-serif !important;
          font-size: 14px !important;
          font-weight: 600 !important;
          height: 40px !important;
          justify-content: center !important;
          line-height: 20px !important;
          padding: 0 32px !important;
          transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1) !important;
          cursor: pointer !important;
          width: 100% !important;
          max-width: 362px !important;
          text-transform: none !important;
          outline: none !important;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05) !important;
        }

        .custom-wallet-button:hover {
          background-color: rgba(0, 0, 0, 0.03) !important;
          border-color: rgba(15, 23, 42, 0.3) !important;
          color: #000000 !important;
        }

        .custom-wallet-button:active {
          transform: scale(0.97) !important;
        }

        .wallet-adapter-dropdown {
          width: auto;
        }

        @media (min-width: 769px) {
          .wallet-connect-container {
            flex-direction: row;
            width: auto;
          }
        }
      `}</style>
    </div>
  );
}
