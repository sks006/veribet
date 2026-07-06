import { useEffect, useState } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { ParametricMarket } from '../types';

export function useAccountSubscription(
  connection: Connection | null,
  marketAddress: PublicKey | null,
  program: any
) {
  const [marketState, setMarketState] = useState<ParametricMarket | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!connection || !marketAddress || !program) {
      setLoading(false);
      return;
    }

    console.log(`[useAccountSubscription] Listening to market PDA: ${marketAddress.toBase58()}`);

    // Fetch initial market state
    let active = true;
    program.account.parametricMarket
      .fetch(marketAddress)
      .then((data: any) => {
        if (active) {
          setMarketState(data as ParametricMarket);
          setLoading(false);
        }
      })
      .catch((err: any) => {
        console.error('[useAccountSubscription] Error fetching market initial state:', err);
        if (active) setLoading(false);
      });

    // Subscribe to websocket account changes
    const subId = connection.onAccountChange(
      marketAddress,
      (accountInfo) => {
        try {
          const decoded = program.coder.accounts.decode(
            'parametricMarket',
            accountInfo.data
          );
          console.log('[useAccountSubscription] On-chain update received:', decoded);
          if (active) {
            setMarketState(decoded as ParametricMarket);
          }
        } catch (err) {
          console.error('[useAccountSubscription] Failed to decode changed account info:', err);
        }
      },
      'confirmed'
    );

    return () => {
      active = false;
      connection.removeAccountChangeListener(subId);
    };
  }, [connection, marketAddress, program]);

  return { marketState, loading };
}
