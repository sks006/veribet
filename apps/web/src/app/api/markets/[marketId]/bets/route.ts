import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import idlJson from '../../../../../../../../target/idl/veribet.json';

const PROGRAM_ID = new PublicKey('2Syq46YQQ4iGbCouFYxjeHEcABScMd669NAK5XrxZFWG');

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

    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || 'http://127.0.0.1:8899';
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

    // 1. Fetch standard markets and match
    const allMarkets = await program.account.parametricMarket.all();
    const matchedMarket = allMarkets.find((m: any) => {
      const mIdStr = Buffer.from(m.account.matchIdBytes).toString('utf8').replace(/\0/g, '');
      return mIdStr === marketIdStr;
    });

    // 2. Fetch prop markets and match
    const allPropMarkets = await program.account.binaryPropMarket.all();
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
        const positions = await program.account.propPosition.all([
          {
            memcmp: {
              offset: 8,
              bytes: pm.publicKey.toBase58(),
            }
          }
        ]);
        
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
        console.error(`Error fetching prop positions for ${pm.publicKey.toBase58()}:`, err);
      }
    }

    const combined = [...standardBets, ...propBets].sort((a, b) => b.timestamp - a.timestamp);

    return NextResponse.json({ bets: combined });
  } catch (err: any) {
    console.error('Error in Recent Bets API route:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
