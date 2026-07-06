import * as anchor from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';

export interface Match {
  id: string;
  homeTeam: string;
  awayTeam: string;
  status: 'LIVE' | 'FINISHED' | 'SCHEDULED';
  homeScore: number;
  awayScore: number;
  totalStats: number;
  kickoffTime: number;
  sport: string;
}

export interface ParametricMarket {
  marketId: anchor.BN;
  sequence: anchor.BN;
  matchIdBytes: number[];
  targetValue: number;
  resolvedValue: number;
  poolSideA: anchor.BN;
  poolSideB: anchor.BN;
  poolSideDraw: anchor.BN;
  totalFeesCollected: anchor.BN;
  crankGasRebatePool: number;
  kickoffTimestamp: anchor.BN;
  emergencyUnlockTimestamp: anchor.BN;
  isResolved: boolean;
  marketType: number;
  marketStatus: number;
  bump: number;
  vaultTokenAccount: PublicKey;
  authority: PublicKey;
  proofHash: number[];
}

export interface UserPosition {
  market: PublicKey;
  userWallet: PublicKey;
  predictionVector: number;
  collateralAmount: anchor.BN;
  tierLevel: number;
  referenceNonce: number;
  claimed: boolean;
  positionBump: number;
  delegatedAuthority: PublicKey;
}
