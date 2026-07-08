import './globals.css';
import { SolanaProvider } from '../components/common/SolanaProvider';
import { WalletConnect } from '../components/common/WalletConnect';
import Link from 'next/link';

export const metadata = {
  title: 'VeriBet | Parametric Prediction Markets',
  description: 'High-performance Solana-based sports prediction protocol powered by TxLINE streams',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="app-container">
        <SolanaProvider>
          <header className="app-header">
            <div className="nav-container">
              <Link href="/" className="logo-wrapper">
                <span className="logo-text">VERI<span className="logo-accent">BET</span></span>
              </Link>
              <nav className="nav-links">
                <Link href="/dashboard" className="nav-link">Markets</Link>
                <Link href="/upcoming" className="nav-link">Upcoming</Link>
                <Link href="/proof-vault" className="nav-link">Proof Vault</Link>
                <Link href="/setup" className="nav-link">API Setup</Link>
              </nav>
              <WalletConnect />
            </div>
          </header>
          <main className="app-main">{children}</main>
          <footer className="app-footer">
            <p className="footer-text">© 2026 VeriBet Protocol. Built on Solana & TxLINE.</p>
          </footer>
        </SolanaProvider>
      </body>
    </html>
  );
}
