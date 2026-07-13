import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import idlJson from '../../../../../types/veribet.json';

import { config } from '../../../../../lib/config';

const PROGRAM_ID = new PublicKey(config.programId);

// In-memory cache to prevent Solana RPC rate-limiting (429)
interface CacheEntry {
  data: any;
  timestamp: number;
}
const betsCache: Record<string, CacheEntry> = {};
const CACHE_TTL_MS = 6000; // 6 seconds

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ marketId: string }> }
) {
  try {
    const { marketId } = await params;
    const marketIdStr = marketId;
    if (!marketIdStr) {
      return NextResponse.json({ error: 'Missing marketId' }, { status: 400 });
    }

    // 1. Check cache first
    const cached = betsCache[marketIdStr];
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return NextResponse.json(cached.data);
    }

    const rpcUrl = config.rpcUrl;
    const connection = new Connection(rpcUrl, 'confirmed');

    const dummyWallet = {
      publicKey: PublicKey.default,
      signTransaction: async (tx: any) => tx,
      signAllTransactions: async (txs: any[]) => txs,
    };
    const provider = new anchor.AnchorProvider(connection, dummyWallet as any, {
      commitment: 'confirmed',
    });
    const program = new anchor.Program(idlJson as any, provider) as any;

    // 2. Fetch base lists in parallel
    const [allMarkets, allPropMarkets, allPropPositions] = await Promise.all([
      program.account.parametricMarket.all(),
      program.account.binaryPropMarket.all(),
      program.account.propPosition.all()
    ]);

    const matchedMarket = allMarkets.find((m: any) => {
      const mIdStr = Buffer.from(m.account.matchIdBytes).toString('utf8').replace(/\0/g, '');
      return mIdStr === marketIdStr;
    });

    const matchedProps = allPropMarkets.filter((m: any) => {
      const mIdStr = Buffer.from(m.account.matchId).toString('utf8').replace(/\0/g, '');
      return mIdStr === marketIdStr;
    });

    let standardBets: any[] = [];
    if (matchedMarket) {
      try {
        const positions = await program.account.userPosition.all([
          {
            memcmp: {
              offset: 8,
              bytes: matchedMarket.publicKey.toBase58(),
            }
          }
        ]);
        standardBets = positions.map((p: any) => ({
          id: p.publicKey.toBase58(),
          type: 'standard',
          marketTitle: 'Match Outcome (Standard)',
          bettor: p.account.userWallet.toBase58(),
          amount: p.account.collateralAmount.toNumber() / 1e6,
          side: p.account.predictionVector === 1 ? 'YES' : 'NO',
          timestamp: Date.now() - 120 * 1000,
        }));
      } catch (err) {
        console.error('Error fetching standard positions:', err);
      }
    }

    let propBets: any[] = [];
    const eventTypes = ["Fouls", "Red Cards", "Yellow Cards", "Corners", "Free Kicks"];
    const comparators = [">=", "<=", "Occurs"];
    
    for (const pm of matchedProps) {
      try {
        const pmKeyStr = pm.publicKey.toBase58();
        // Filter the fetched prop positions in memory
        const positions = allPropPositions.filter(
          (p: any) => p.account.market.toBase58() === pmKeyStr
        );
        
        const eventName = eventTypes[pm.account.eventType] || "Event";
        const comp = comparators[pm.account.comparator] || "";
        const team = pm.account.team === 0 ? "Home" : "Away";
        const title = `${eventName} (${team}) ${comp} ${pm.account.threshold}`;

        propBets.push(...positions.map((p: any) => ({
          id: p.publicKey.toBase58(),
          type: 'prop',
          marketTitle: title,
          bettor: p.account.bettor.toBase58(),
          amount: p.account.amount.toNumber() / 1e6,
          side: p.account.side ? 'YES' : 'NO',
          timestamp: p.account.placedAt.toNumber() * 1000,
        })));
      } catch (err) {
        console.error(`Error filtering prop positions for ${pm.publicKey.toBase58()}:`, err);
      }
    }

    const combined = [...standardBets, ...propBets].sort((a, b) => b.timestamp - a.timestamp);
    const responseData = { bets: combined };

    // Save to cache
    betsCache[marketIdStr] = {
      data: responseData,
      timestamp: Date.now()
    };

    return NextResponse.json(responseData);
  } catch (err: any) {
    console.error('Error in Recent Bets API route:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
