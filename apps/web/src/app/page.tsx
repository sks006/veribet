'use client';

import React from 'react';
import Link from 'next/link';
import { Shield, Zap, Sparkles, Activity, BadgePercent, Coins } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="landing-page">
      <div className="hero-section">
        <div className="hero-glow"></div>
        <div className="hero-badge">
          <Sparkles size={12} className="text-indigo-400" />
          <span>Next-Generation Solana Betting Protocol</span>
        </div>
        <h1 className="hero-title">
          Parametric Sports <br />
          <span className="hero-title-gradient">Prediction Markets</span>
        </h1>
        <p className="hero-desc">
          Zero-slippage prediction pools settled instantly via cryptographic oracle proofs and TxLINE stream feeds, powered by self-sustaining user-funded gas rebate crankers.
        </p>
        
        <div className="hero-actions">
          <Link href="/dashboard" className="primary-btn">
            Explore Live Markets
          </Link>
          <a href="#features" className="secondary-btn">
            Learn More
          </a>
        </div>
      </div>

      <div id="features" className="features-grid">
        <div className="feature-card">
          <div className="feature-icon-wrapper">
            <Zap className="feature-icon" size={24} />
          </div>
          <h3 className="feature-name">Instant Settlements</h3>
          <p className="feature-desc">
            Stateless off-chain crank services monitor Server-Sent Event feeds from TxLINE to resolve on-chain prediction pools automatically within seconds of match conclusion.
          </p>
        </div>

        <div className="feature-card">
          <div className="feature-icon-wrapper">
            <Coins className="feature-icon" size={24} />
          </div>
          <h3 className="feature-name">Self-Sustaining Crank</h3>
          <p className="feature-desc">
            Users contribute 0.005 SOL per placed prediction into a dedicated gas rebate pool. Cranks receive this rebate upon successful resolution, ensuring continuous uptime.
          </p>
        </div>

        <div className="feature-card">
          <div className="feature-icon-wrapper">
            <Shield className="feature-icon" size={24} />
          </div>
          <h3 className="feature-name">100% On-Chain Proofs</h3>
          <p className="feature-desc">
            All outcomes require a 32-byte cryptographic SHA-256 proof hash verification before claims are enabled, eliminating admin intervention and counterparty risk.
          </p>
        </div>
      </div>

      <style jsx>{`
        .landing-page {
          display: flex;
          flex-direction: column;
          gap: 6rem;
          padding: 4rem 0;
        }

        .hero-section {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          max-width: 800px;
          margin: 0 auto;
          gap: 1.5rem;
        }

        .hero-glow {
          position: absolute;
          top: -150px;
          width: 500px;
          height: 300px;
          background: radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, rgba(99, 102, 241, 0) 70%);
          z-index: -1;
          pointer-events: none;
        }

        .hero-badge {
          background: rgba(99, 102, 241, 0.08);
          border: 1px solid rgba(99, 102, 241, 0.2);
          border-radius: 9999px;
          padding: 0.35rem 0.85rem;
          font-size: 0.8rem;
          font-weight: 600;
          color: #a5b4fc;
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }

        .hero-title {
          font-size: 3.5rem;
          font-weight: 900;
          line-height: 1.1;
          letter-spacing: -0.04em;
          color: #ffffff;
        }

        .hero-title-gradient {
          background: linear-gradient(135deg, #6366f1 0%, #38bdf8 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .hero-desc {
          font-size: 1.15rem;
          color: #94a3b8;
          line-height: 1.6;
          max-width: 650px;
        }

        .hero-actions {
          display: flex;
          gap: 1rem;
          margin-top: 1rem;
        }

        .primary-btn {
          background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
          border: none;
          color: #ffffff;
          font-size: 0.95rem;
          font-weight: 700;
          padding: 0.95rem 1.8rem;
          border-radius: 12px;
          text-decoration: none;
          transition: all 0.2s ease;
          box-shadow: 0 4px 15px rgba(79, 70, 229, 0.3);
        }

        .primary-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(79, 70, 229, 0.4);
        }

        .secondary-btn {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #cbd5e1;
          font-size: 0.95rem;
          font-weight: 700;
          padding: 0.95rem 1.8rem;
          border-radius: 12px;
          text-decoration: none;
          transition: all 0.2s ease;
        }

        .secondary-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #ffffff;
        }

        .features-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 2rem;
        }

        @media (max-width: 768px) {
          .features-grid {
            grid-template-columns: 1fr;
          }
          .hero-title {
            font-size: 2.5rem;
          }
        }

        .feature-card {
          background: rgba(30, 41, 59, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.03);
          border-radius: 20px;
          padding: 2rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
          transition: all 0.3s ease;
        }

        .feature-card:hover {
          background: rgba(30, 41, 59, 0.3);
          border-color: rgba(99, 102, 241, 0.2);
        }

        .feature-icon-wrapper {
          background: rgba(99, 102, 241, 0.1);
          border: 1px solid rgba(99, 102, 241, 0.2);
          width: 48px;
          height: 48px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .feature-icon {
          color: #818cf8;
        }

        .feature-name {
          font-size: 1.15rem;
          font-weight: 700;
          color: #f8fafc;
        }

        .feature-desc {
          font-size: 0.85rem;
          color: #64748b;
          line-height: 1.5;
        }
      `}</style>
    </div>
  );
}
