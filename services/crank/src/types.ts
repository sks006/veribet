export interface TxLineEvent {
  matchId: string;       // e.g. "LIV-MCI-2026"
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED';
  homeScore: number;
  awayScore: number;
  totalStats: number;    // e.g. corner count, total goals, or yellow cards
  timestamp: number;
  signature: string;     // Hex-encoded cryptographic signature
  eventType?: 'foul' | 'red_card' | 'yellow_card' | 'corner' | 'free_kick';
  team?: 0 | 1;          // 0 = Home (A), 1 = Away (B)
  matchMinute?: number;
}

export interface CrankConfig {
  rpcUrl: string;
  programId: string;
  authorityKeypairPath: string; // Path to the authority private key (to sign transactions)
  txlineUrl: string;            // SSE endpoint for TxLINE stream
}
