import { useMemo } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { useAnchorWallet, useConnection } from '@solana/wallet-adapter-react';
import idlJson from '../types/veribet.json';

import { config } from '../lib/config';

const PROGRAM_ID = new PublicKey(config.programId);

export function useProgram() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  const program = useMemo(() => {
    // If wallet is not connected, use a read-only Provider
    if (!wallet) {
      const dummyWallet = {
        publicKey: PublicKey.default,
        signTransaction: async (tx: any) => tx,
        signAllTransactions: async (txs: any[]) => txs,
      };
      const provider = new anchor.AnchorProvider(connection, dummyWallet as any, {
        commitment: 'confirmed',
      });
      return new anchor.Program(idlJson as any, provider) as any;
    }
    
    const provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: 'confirmed',
    });
    return new anchor.Program(idlJson as any, provider) as any;
  }, [connection, wallet]);

  return { program, connection, programId: PROGRAM_ID };
}
