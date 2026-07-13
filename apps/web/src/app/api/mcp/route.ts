import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey, Keypair, Transaction, SystemProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import idlJson from '../../../types/veribet.json';
import { 
  createAssociatedTokenAccountInstruction, 
  getAssociatedTokenAddress, 
  createSyncNativeInstruction 
} from '@solana/spl-token';

import { config } from '../../../lib/config';

const PROGRAM_ID = new PublicKey(config.programId);
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

let cachedAuthorityKeypair: Keypair | null = null;

function getDelegatedAuthorityKeypair(): Keypair {
  if (cachedAuthorityKeypair) {
    return cachedAuthorityKeypair;
  }
  let resolvedPath = '';
  const envPath = process.env.AUTHORITY_KEY_PATH;
  if (envPath) {
    const p = path.resolve(envPath);
    if (fs.existsSync(p)) {
      resolvedPath = p;
    }
  }
  if (!resolvedPath) {
    const pathsToSearch = [
      path.join(process.cwd(), '../../authority-keypair.json'),
      path.join(process.cwd(), '../authority-keypair.json'),
      path.join(process.cwd(), 'authority-keypair.json'),
      path.join(__dirname, '../../../../authority-keypair.json'),
      path.join(__dirname, '../../../../../../authority-keypair.json'),
    ];
    for (const p of pathsToSearch) {
      if (fs.existsSync(p)) {
        resolvedPath = p;
        break;
      }
    }
  }
  if (resolvedPath) {
    try {
      const raw = fs.readFileSync(resolvedPath, 'utf8');
      const secret = Uint8Array.from(JSON.parse(raw));
      cachedAuthorityKeypair = Keypair.fromSecretKey(secret);
      return cachedAuthorityKeypair;
    } catch (e) {
      console.warn(`Failed to read keypair from ${resolvedPath}:`, e);
    }
  }
  cachedAuthorityKeypair = Keypair.generate();
  return cachedAuthorityKeypair;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    if (action === 'list_events') {
      const apiToken = process.env.TXLINE_API_TOKEN || '';
      const targetNetwork = (process.env.TXLINE_NETWORK || process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet') as 'mainnet' | 'devnet';
      const apiOrigin = targetNetwork === 'mainnet' ? 'https://txline.txodds.com' : 'https://txline-dev.txodds.com';

      // 1. Fetch Guest JWT
      const authRes = await fetch(`${apiOrigin}/auth/guest/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!authRes.ok) {
        throw new Error(`Guest auth failed with status ${authRes.status}`);
      }
      const authData = await authRes.json();
      const jwt = authData.token || authData.jwt || '';

      // 2. Fetch baseline snapshot
      const snapshotUrl = `${apiOrigin}/api/fixtures/snapshot`;
      const fixturesRes = await fetch(snapshotUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'X-Api-Token': apiToken
        }
      });

      if (!fixturesRes.ok) {
        throw new Error(`Baseline snapshot fetch returned status ${fixturesRes.status}`);
      }

      const data = await fixturesRes.json();
      const fixtures = Array.isArray(data) ? data : (data.fixtures || data.data || []);

      // 3. Map fixtures to standard event format
      const events = fixtures.map((f: any) => {
        const homeTeam = f.homeTeam?.name || f.homeName || 'Home Team';
        const awayTeam = f.awayTeam?.name || f.awayName || 'Away Team';
        const status = f.status === 'NS' || f.statusId === 1 ? 'SCHEDULED' : f.status === 'LIVE' || f.statusId === 2 ? 'LIVE' : 'FINISHED';
        return {
          matchId: f.fixtureId || f.id || String(f.fixtureId),
          homeTeam,
          awayTeam,
          status,
          statusId: f.statusId || (status === 'SCHEDULED' ? 1 : status === 'LIVE' ? 2 : 3),
          homeScore: f.scores?.home || f.homeScore || 0,
          awayScore: f.scores?.away || f.awayScore || 0,
          kickoffTime: f.kickoffTime || f.start_time || Date.now(),
          sport: f.sport || 'Football'
        };
      });

      return NextResponse.json({ events });
    }

    return NextResponse.json({ error: 'Unsupported GET action' }, { status: 400 });
  } catch (err: any) {
    console.error('MCP GET Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    const rpcUrl = config.rpcUrl;
    const connection = new Connection(rpcUrl, 'confirmed');

    const authorityKeypair = getDelegatedAuthorityKeypair();
    const dummyWallet = {
      publicKey: authorityKeypair.publicKey,
      signTransaction: async (tx: Transaction) => {
        tx.partialSign(authorityKeypair);
        return tx;
      },
      signAllTransactions: async (txs: Transaction[]) => {
        txs.forEach(t => t.partialSign(authorityKeypair));
        return txs;
      },
    };
    const provider = new anchor.AnchorProvider(connection, dummyWallet as any, {
      commitment: 'confirmed',
    });
    const program = new anchor.Program(idlJson as any, provider) as any;

    if (action === 'create_market') {
      const { matchId, eventType, team, comparator, threshold, window, displayTitle } = body;
      if (!matchId) {
        return NextResponse.json({ error: 'Missing matchId' }, { status: 400 });
      }

      const marketIdBytes = crypto.getRandomValues(new Uint8Array(32));
      const matchIdBytes = Buffer.alloc(32);
      Buffer.from(matchId).copy(matchIdBytes);

      const thresholdBuffer = Buffer.alloc(2);
      thresholdBuffer.writeUInt16LE(threshold || 0);

      const [marketAddress] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('prop_market'),
          matchIdBytes,
          Buffer.from([eventType || 0]),
          Buffer.from([team || 0]),
          thresholdBuffer
        ],
        PROGRAM_ID
      );
      const [vaultAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), marketAddress.toBuffer()],
        PROGRAM_ID
      );

      const display = displayTitle || `Prop: Event ${eventType} Team ${team}`;
      const bettingClosesAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour default

      console.log("=== TS DERIVATION SEEDS ===");
      console.log("matchIdBytes:", Array.from(matchIdBytes));
      console.log("eventType:", eventType || 0);
      console.log("team:", team || 0);
      console.log("thresholdBuffer:", Array.from(thresholdBuffer));

      const txSig = await program.methods
        .createPropMarket(
          Array.from(marketIdBytes),
          Array.from(matchIdBytes),
          eventType || 0,
          team || 0,
          comparator || 0,
          threshold || 0,
          window || 2,
          display,
          new anchor.BN(bettingClosesAt)
        )
        .accounts({
          market: marketAddress,
          creator: authorityKeypair.publicKey,
          vaultTokenAccount: vaultAddress,
          vaultMint: WSOL_MINT,
          oracleAuthority: authorityKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      return NextResponse.json({
        success: true,
        marketAddress: marketAddress.toBase58(),
        txSig,
      });
    }

    if (action === 'place_bet') {
      const { marketAddress, side, amount } = body;
      if (!marketAddress || side === undefined || !amount) {
        return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
      }

      const marketPubKey = new PublicKey(marketAddress);
      const [positionAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from('prop_position'), marketPubKey.toBuffer(), authorityKeypair.publicKey.toBuffer()],
        PROGRAM_ID
      );
      const [vaultAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), marketPubKey.toBuffer()],
        PROGRAM_ID
      );

      const userTokenAccount = await getAssociatedTokenAddress(WSOL_MINT, authorityKeypair.publicKey);
      const amountLamports = amount * 1e9;

      const tx = new Transaction();
      
      const ataInfo = await connection.getAccountInfo(userTokenAccount);
      if (!ataInfo) {
        tx.add(
          createAssociatedTokenAccountInstruction(
            authorityKeypair.publicKey,
            userTokenAccount,
            authorityKeypair.publicKey,
            WSOL_MINT
          )
        );
      }

      tx.add(
        SystemProgram.transfer({
          fromPubkey: authorityKeypair.publicKey,
          toPubkey: userTokenAccount,
          lamports: amountLamports,
        })
      );
      tx.add(createSyncNativeInstruction(userTokenAccount));

      const betInstruction = await program.methods
        .placePropBet(side, new anchor.BN(amountLamports))
        .accounts({
          market: marketPubKey,
          userPosition: positionAddress,
          bettor: authorityKeypair.publicKey,
          userTokenAccount: userTokenAccount,
          vaultTokenAccount: vaultAddress,
          systemProgram: SystemProgram.programId,
        } as any)
        .instruction();

      tx.add(betInstruction);

      const txSig = await connection.sendTransaction(tx, [authorityKeypair], {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      await connection.confirmTransaction(txSig, 'confirmed');

      return NextResponse.json({
        success: true,
        positionAddress: positionAddress.toBase58(),
        txSig,
      });
    }

    if (action === 'check_resolution') {
      const { marketAddress } = body;
      if (!marketAddress) {
        return NextResponse.json({ error: 'Missing marketAddress' }, { status: 400 });
      }

      const marketPubKey = new PublicKey(marketAddress);
      const marketAcc = await program.account.binaryPropMarket.fetch(marketPubKey);

      return NextResponse.json({
        marketAddress: marketPubKey.toBase58(),
        resolved: marketAcc.resolved,
        resolvedValue: marketAcc.resolvedValue,
        bettable: marketAcc.bettable,
        poolYes: marketAcc.poolYes.toNumber() / 1e9,
        poolNo: marketAcc.poolNo.toNumber() / 1e9,
      });
    }

    return NextResponse.json({ error: 'Unsupported POST action' }, { status: 400 });
  } catch (err: any) {
    console.error('MCP API Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
