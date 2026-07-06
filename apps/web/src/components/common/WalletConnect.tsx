'use client';

import React from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

// Import default styles
import '@solana/wallet-adapter-react-ui/styles.css';

export function WalletConnect() {
  return (
    <div className="wallet-connect-wrapper">
      <WalletMultiButton className="custom-wallet-button" />
      <style jsx global>{`
        .custom-wallet-button {
          align-items: center !important;
          appearance: button !important;
          background-color: rgba(0, 0, 0, 0) !important;
          border: 1px solid rgb(36, 43, 50) !important;
          border-radius: 9999px !important;
          color: rgb(222, 227, 231) !important;
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
          width: 362px !important;
          text-transform: none !important;
          outline: none !important;
        }
        .custom-wallet-button:hover {
          background-color: rgba(255, 255, 255, 0.05) !important;
          border-color: rgb(50, 60, 70) !important;
          color: #ffffff !important;
        }
        .custom-wallet-button:active {
          transform: scale(0.97) !important;
        }
        .wallet-adapter-dropdown {
          width: auto;
        }
      `}</style>
    </div>
  );
}
