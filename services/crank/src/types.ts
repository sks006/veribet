export interface TxLineEvent {
  matchId: string;       // e.g. "LIV-MCI-2026"
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED';
  homeScore: number;
  awayScore: number;
  totalStats: number;    // e.g. corner count, total goals, or yellow cards
  timestamp: number;
  signature: string;     // Hex-encoded cryptographic signature
}

export interface CrankConfig {
  rpcUrl: string;
  programId: string;
  authorityKeypairPath: string; // Path to the authority private key (to sign transactions)
  txlineUrl: string;            // SSE endpoint for TxLINE stream
}
