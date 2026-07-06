import * as crypto from 'crypto';
import { TxLineEvent } from './types';

export class ProofHandler {
  /**
   * Verifies the cryptographic signature of the match outcome event.
   * If publicKeyHex is "mock", it will bypass actual cryptographic checks and return true.
   */
  public static verifyProof(event: TxLineEvent, publicKeyHex: string): boolean {
    if (publicKeyHex === 'mock' || !publicKeyHex) {
      console.log(`[Proof Handler] Bypassing cryptographic validation for match: ${event.matchId} (Mock Mode)`);
      return true;
    }

    try {
      const message = `${event.matchId}:${event.status}:${event.homeScore}:${event.awayScore}:${event.totalStats}:${event.timestamp}`;
      const msgBuffer = Buffer.from(message, 'utf8');
      const sigBuffer = Buffer.from(event.signature, 'hex');
      const pubKeyBuffer = Buffer.from(publicKeyHex, 'hex');

      return crypto.verify(
        undefined,
        msgBuffer,
        {
          key: pubKeyBuffer,
          format: 'der',
          type: 'spki',
        },
        sigBuffer
      );
    } catch (err: any) {
      console.error(`[Proof Handler] Cryptographic verification failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Generates a 32-byte SHA256 proof hash of the TxLineEvent.
   */
  public static generateProofHash(event: TxLineEvent): number[] {
    const serialized = JSON.stringify(event);
    const hash = crypto.createHash('sha256').update(serialized).digest();
    return Array.from(hash);
  }
}
