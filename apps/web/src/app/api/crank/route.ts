import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import idlJson from '../../../types/veribet.json';
import { config } from '../../../lib/config';

// -------------------------------------------------------------
// Type Definitions
// -------------------------------------------------------------

interface TxLineEvent {
  matchId: string;
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED';
  homeScore: number;
  awayScore: number;
  totalStats: number;
  timestamp: number;
  signature: string;
  eventType?: 'foul' | 'red_card' | 'yellow_card' | 'corner' | 'free_kick';
  team?: 0 | 1;
  matchMinute?: number;
}

interface PropStats {
  fouls: [number, number];
  redCards: [number, number];
  yellowCards: [number, number];
  corners: [number, number];
  freeKicks: [number, number];
  matchMinute: number;
}

// -------------------------------------------------------------
// Helper Functions
// -------------------------------------------------------------

function parseSseBlock(block: string): { data: string } | null {
  const message = { data: "" };
  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue;
    const separatorIndex = rawLine.indexOf(":");
    const field = separatorIndex === -1 ? rawLine : rawLine.slice(0, separatorIndex);
    const value = separatorIndex === -1 ? "" : rawLine.slice(separatorIndex + 1).replace(/^ /, "");
    if (field === "data") message.data += `${value}\n`;
  }
  message.data = message.data.replace(/\n$/, "");
  return message.data ? message : null;
}

async function getMintFromVault(connection: Connection, vaultAddress: PublicKey): Promise<PublicKey> {
  try {
    const vaultInfo: any = await connection.getParsedAccountInfo(vaultAddress);
    if (vaultInfo.value?.data?.parsed?.info?.mint) {
      return new PublicKey(vaultInfo.value.data.parsed.info.mint);
    }
  } catch (err) {
    console.error('[Crank API] Failed to parse vault mint:', err);
  }
  return new PublicKey('So11111111111111111111111111111111111111112'); // WSOL fallback
}

function generateProofHash(event: TxLineEvent): number[] {
  const serialized = JSON.stringify(event);
  const hash = crypto.createHash('sha256').update(serialized).digest();
  return Array.from(hash);
}

function getStatValue(stats: PropStats, eventType: number, team: number): number {
  const teamIdx = team === 1 ? 1 : 0;
  switch (eventType) {
    case 0: return stats.fouls[teamIdx];
    case 1: return stats.redCards[teamIdx];
    case 2: return stats.yellowCards[teamIdx];
    case 3: return stats.corners[teamIdx];
    case 4: return stats.freeKicks[teamIdx];
    default: return 0;
  }
}

function evaluatePropResolution(marketAccount: any, stats: PropStats): boolean {
  const value = getStatValue(stats, marketAccount.eventType, marketAccount.team);
  // comparator: 0=CountGte, 1=CountLte, 2=Occurs
  if (marketAccount.comparator === 0) {
    return value >= marketAccount.threshold;
  } else if (marketAccount.comparator === 1) {
    return value <= marketAccount.threshold;
  } else if (marketAccount.comparator === 2) {
    return value > 0;
  }
  return false;
}

async function fetchMatchStatsAndEvent(
  matchId: string,
  jwt: string,
  apiToken: string,
  apiOrigin: string
): Promise<{ stats: PropStats; finalEvent: TxLineEvent } | null> {
  const headers = {
    'Authorization': `Bearer ${jwt}`,
    'X-Api-Token': apiToken
  };

  const url = `${apiOrigin}/api/scores/historical/${matchId}`;
  try {
    const res = await fetch(url, { method: 'GET', headers });
    if (res.status !== 200) {
      return null;
    }
    const text = await res.text();
    const blocks = text.split(/\n\n+/);
    
    const stats: PropStats = {
      fouls: [0, 0],
      redCards: [0, 0],
      yellowCards: [0, 0],
      corners: [0, 0],
      freeKicks: [0, 0],
      matchMinute: 0
    };
    
    let lastEvent: TxLineEvent | null = null;

    for (const block of blocks) {
      if (!block.trim()) continue;
      const parsed = parseSseBlock(block);
      if (parsed && parsed.data) {
        try {
          const rawPayload = JSON.parse(parsed.data);
          
          const info = rawPayload.FixtureInfo || {};
          const update = rawPayload.Update || {};
          const p1IsHome = info.Participant1IsHome ?? rawPayload.Participant1IsHome ?? true;
          const rawP1 = info.Participant1 || rawPayload.Participant1 || rawPayload.homeTeam || '';
          const rawP2 = info.Participant2 || rawPayload.Participant2 || rawPayload.awayTeam || '';
          const homeTeam = p1IsHome ? rawP1 : rawP2;
          const awayTeam = p1IsHome ? rawP2 : rawP1;

          let homeScore = 0;
          let awayScore = 0;
          if (update.Scores) {
            homeScore = update.Scores.Participant1 ?? 0;
            awayScore = update.Scores.Participant2 ?? 0;
          } else if (rawPayload.Scores) {
            homeScore = rawPayload.Scores.Participant1 ?? 0;
            awayScore = rawPayload.Scores.Participant2 ?? 0;
          } else {
            homeScore = rawPayload.homeScore ?? rawPayload.home_score ?? 0;
            awayScore = rawPayload.awayScore ?? rawPayload.away_score ?? 0;
          }

          const statusId = update.StatusId ?? rawPayload.GameState ?? 2;
          const statusStr = statusId === 3 ? 'FINISHED' : (statusId === 2 ? 'LIVE' : 'SCHEDULED');
          
          const event: TxLineEvent = {
            matchId,
            status: statusStr,
            homeScore,
            awayScore,
            totalStats: homeScore + awayScore,
            timestamp: Date.now(),
            signature: rawPayload.signature || update.ServerId || 'txline_verified_signature',
            eventType: rawPayload.eventType || undefined,
            team: rawPayload.team !== undefined ? rawPayload.team : undefined,
            matchMinute: rawPayload.matchMinute || undefined
          };
          
          lastEvent = event;

          if (event.eventType && event.team !== undefined) {
            const teamIdx = event.team === 1 ? 1 : 0;
            if (event.eventType === 'foul') stats.fouls[teamIdx]++;
            else if (event.eventType === 'red_card') stats.redCards[teamIdx]++;
            else if (event.eventType === 'yellow_card') stats.yellowCards[teamIdx]++;
            else if (event.eventType === 'corner') stats.corners[teamIdx]++;
            else if (event.eventType === 'free_kick') stats.freeKicks[teamIdx]++;
          } else {
            // Fallback simulated metrics
            const currentTotal = stats.corners[0] + stats.corners[1] + stats.fouls[0] + stats.fouls[1];
            if (event.totalStats > currentTotal) {
              const diff = event.totalStats - currentTotal;
              for (let i = 0; i < diff; i++) {
                const team = (currentTotal + i) % 2 === 0 ? 0 : 1;
                const isCorner = (currentTotal + i) % 3 === 0;
                if (isCorner) {
                  stats.corners[team]++;
                } else {
                  stats.fouls[team]++;
                }
              }
            }
          }
        } catch {}
      }
    }

    if (lastEvent) {
      return { stats, finalEvent: lastEvent };
    }
  } catch (err: any) {
    console.error(`[Crank API] Error fetching historical scores for ${matchId}:`, err.message);
  }
  return null;
}

// -------------------------------------------------------------
// Main GET Request Handler
// -------------------------------------------------------------

export async function GET(request: NextRequest) {
  // 1. Authenticate Vercel Cron Trigger
  const authHeader = (request.headers.get('authorization') || '').trim();
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const isDev = process.env.NODE_ENV === 'development';
  const bypassAuth = request.nextUrl.searchParams.get('bypassAuth') === 'true';

  let isAuthorized = false;
  if (isDev && bypassAuth) {
    isAuthorized = true;
  } else if (cronSecret) {
    isAuthorized = authHeader === `Bearer ${cronSecret}` || authHeader === cronSecret;
  }

  if (!isAuthorized) {
    return new NextResponse('Unauthorized Instruction Call', { status: 401 });
  }

  const reports: string[] = [];
  let processedCount = 0;

  try {
    reports.push(`[Crank API] Ignition starting...`);

    // 2. Resolve TxLINE API Token
    let apiToken = process.env.TXLINE_API_TOKEN || '';
    if (!apiToken) {
      try {
        const pathsToSearch = [
          path.join(process.cwd(), '../../txline-config.json'),
          path.join(process.cwd(), '../txline-config.json'),
          path.join(process.cwd(), 'txline-config.json'),
        ];
        let foundPath = '';
        for (const p of pathsToSearch) {
          if (fs.existsSync(p)) {
            foundPath = p;
            break;
          }
        }
        if (foundPath) {
          const savedConfig = JSON.parse(fs.readFileSync(foundPath, 'utf8'));
          if (savedConfig.apiToken) {
            apiToken = savedConfig.apiToken;
            reports.push(`[Crank API] Loaded TxLINE token from config file: ${foundPath}`);
          }
        }
      } catch (e: any) {
        console.warn("Failed to load local config token:", e.message);
      }
    }

    // 3. Resolve Authority Wallet (Crank Signer)
    let authorityKeypair: Keypair;
    const signerKeyRaw = process.env.CRANK_SIGNER_KEY || process.env.AUTHORITY_KEY;
    if (!signerKeyRaw) {
      // Fallback search local directory authority file if dev
      let localPath = path.resolve(process.cwd(), '../../authority-keypair.json');
      if (!fs.existsSync(localPath)) {
        localPath = path.resolve(process.cwd(), 'authority-keypair.json');
      }
      if (fs.existsSync(localPath)) {
        const raw = fs.readFileSync(localPath, 'utf8');
        authorityKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
        reports.push(`[Crank API] Loaded authority keypair from file: ${localPath}`);
      } else {
        throw new Error("Missing CRANK_SIGNER_KEY/AUTHORITY_KEY and no local keypair found.");
      }
    } else {
      try {
        if (signerKeyRaw.trim().startsWith('[')) {
          const secretKey = Uint8Array.from(JSON.parse(signerKeyRaw));
          authorityKeypair = Keypair.fromSecretKey(secretKey);
        } else {
          const decoded = anchor.utils.bytes.bs58.decode(signerKeyRaw.trim());
          authorityKeypair = Keypair.fromSecretKey(decoded);
        }
        reports.push(`[Crank API] Instantiated authority keypair from environment: ${authorityKeypair.publicKey.toBase58()}`);
      } catch (err: any) {
        throw new Error(`Failed to parse CRANK_SIGNER_KEY: ${err.message}`);
      }
    }

    // 4. Setup Anchor connection and program abstraction
    const connection = new Connection(config.rpcUrl, 'confirmed');
    const dummyWallet = {
      publicKey: authorityKeypair.publicKey,
      signTransaction: async (tx: any) => {
        tx.partialSign(authorityKeypair);
        return tx;
      },
      signAllTransactions: async (txs: any[]) => {
        txs.forEach(t => t.partialSign(authorityKeypair));
        return txs;
      },
    };
    const provider = new anchor.AnchorProvider(connection, dummyWallet as any, { commitment: 'confirmed' });
    const program = new anchor.Program(idlJson as any, provider) as any;

    reports.push(`[Crank API] Solana connected. Target RPC: ${config.rpcUrl}`);

    // 5. Negotiate TxLINE authentication and fetch baseline snapshot
    const targetNetwork = (process.env.TXLINE_NETWORK || process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet') as 'mainnet' | 'devnet';
    const apiOrigin = targetNetwork === 'mainnet' ? 'https://txline.txodds.com' : 'https://txline-dev.txodds.com';

    reports.push(`[Crank API] Fetching TxLINE auth guest JWT from ${apiOrigin}...`);
    const authRes = await fetch(`${apiOrigin}/auth/guest/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!authRes.ok) {
      throw new Error(`Guest auth failed with status ${authRes.status}`);
    }
    const authData = await authRes.json();
    const jwt = authData.token || authData.jwt || '';

    reports.push(`[Crank API] Fetching baseline snapshot...`);
    const fixturesRes = await fetch(`${apiOrigin}/api/fixtures/snapshot`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'X-Api-Token': apiToken
      }
    });
    if (!fixturesRes.ok) {
      throw new Error(`Baseline snapshot fetch returned status ${fixturesRes.status}`);
    }
    const fixtures = await fixturesRes.json() as any[];
    reports.push(`[Crank API] Snapshot loaded. Total fixtures: ${fixtures.length}`);

    // 6. Scan on-chain markets
    reports.push(`[Crank API] Scanning unresolved accounts from Solana...`);
    const unresolvedPropMarkets = (await program.account.binaryPropMarket.all()).filter((m: any) => !m.account.resolved);
    const unresolvedParametricMarkets = (await program.account.parametricMarket.all()).filter((m: any) => !m.account.isResolved);
    
    reports.push(`[Crank API] Found ${unresolvedPropMarkets.length} unresolved Prop Markets and ${unresolvedParametricMarkets.length} standard Parametric Markets.`);

    // 7. Iterate Prop Markets
    for (const m of unresolvedPropMarkets) {
      const matchIdStr = Buffer.from(m.account.matchId)
        .toString('utf8')
        .replace(/\0/g, '');

      reports.push(`[Crank API] Checking Prop Market ${m.publicKey.toBase58()} (Match ID: ${matchIdStr})`);
      
      const fixture = fixtures.find(f => String(f.FixtureId || f.id) === matchIdStr);
      if (!fixture) {
        reports.push(`[Crank API] Match ID ${matchIdStr} not found in TxLINE snapshot. Skipping.`);
        continue;
      }

      // Fetch historical metrics to check latest scores and stats
      const result = await fetchMatchStatsAndEvent(matchIdStr, jwt, apiToken, apiOrigin);
      if (!result) {
        reports.push(`[Crank API] Historical scores not available for ${matchIdStr}. Skipping.`);
        continue;
      }

      const { stats, finalEvent } = result;

      // Check early close gating
      if (m.account.bettable) {
        let shouldClose = false;
        const currentMinute = stats.matchMinute;

        if (m.account.window === 0 && currentMinute >= 35) shouldClose = true;
        else if (m.account.window === 1 && currentMinute >= 80) shouldClose = true;
        else if (m.account.window === 2 && finalEvent.status !== 'SCHEDULED') shouldClose = true;

        if (shouldClose) {
          reports.push(`[Crank API] Early close triggered for market ${m.publicKey.toBase58()} (Minute ${currentMinute})`);
          try {
            const txSig = await program.methods
              .closeBettingEarly()
              .accounts({
                market: m.publicKey,
                oracleAuthority: authorityKeypair.publicKey,
              } as any)
              .signers([authorityKeypair])
              .rpc();
            reports.push(`[Crank API] Betting closed early! Tx Sig: ${txSig}`);
            processedCount++;
          } catch (err: any) {
            reports.push(`[Crank API] Failed to close betting early for ${m.publicKey.toBase58()}: ${err.message}`);
          }
        }
      }

      // Check resolution gating
      if (finalEvent.status === 'FINISHED') {
        const resolvedValue = evaluatePropResolution(m.account, stats);
        const proofHash = generateProofHash(finalEvent);
        reports.push(`[Crank API] Resolving prop market ${m.publicKey.toBase58()} to ${resolvedValue}`);
        
        try {
          const vaultAddress = m.account.vaultTokenAccount;
          const vaultMint = await getMintFromVault(connection, vaultAddress);
          const creatorTokenAccount = await getAssociatedTokenAddress(vaultMint, m.account.creator);

          const txSig = await program.methods
            .resolvePropMarket(resolvedValue, proofHash)
            .accounts({
              market: m.publicKey,
              oracleAuthority: authorityKeypair.publicKey,
              vaultTokenAccount: vaultAddress,
              creatorTokenAccount: creatorTokenAccount,
              crank: authorityKeypair.publicKey,
            } as any)
            .signers([authorityKeypair])
            .rpc();

          reports.push(`[Crank API] Prop market resolved successfully! Tx Sig: ${txSig}`);
          processedCount++;
        } catch (err: any) {
          reports.push(`[Crank API] Failed to resolve prop market ${m.publicKey.toBase58()}: ${err.message}`);
        }
      }
    }

    // 8. Iterate standard Parametric Markets
    for (const m of unresolvedParametricMarkets) {
      const matchIdStr = Buffer.from(m.account.matchIdBytes)
        .toString('utf8')
        .replace(/\0/g, '');

      reports.push(`[Crank API] Checking Parametric Market ${m.publicKey.toBase58()} (Match ID: ${matchIdStr})`);

      const fixture = fixtures.find(f => String(f.FixtureId || f.id) === matchIdStr);
      if (!fixture) {
        reports.push(`[Crank API] Match ID ${matchIdStr} not found in TxLINE snapshot. Skipping.`);
        continue;
      }

      const result = await fetchMatchStatsAndEvent(matchIdStr, jwt, apiToken, apiOrigin);
      if (!result) {
        reports.push(`[Crank API] Historical scores not available for ${matchIdStr}. Skipping.`);
        continue;
      }

      const { finalEvent } = result;

      // Check resolution gating
      if (finalEvent.status === 'FINISHED') {
        let resolvedValue = 0;
        if (m.account.marketType === 0) {
          resolvedValue = finalEvent.totalStats;
        } else {
          resolvedValue = finalEvent.totalStats >= m.account.targetValue ? 1 : 0;
        }

        const proofHash = generateProofHash(finalEvent);
        reports.push(`[Crank API] Resolving parametric market ${m.publicKey.toBase58()} with value ${resolvedValue}`);

        try {
          const vaultAddress = m.account.vaultTokenAccount;
          const vaultMint = await getMintFromVault(connection, vaultAddress);
          const authorityTokenAccount = await getAssociatedTokenAddress(vaultMint, m.account.authority);

          const txSig = await program.methods
            .resolveMarket(resolvedValue, proofHash)
            .accounts({
              market: m.publicKey,
              authority: authorityKeypair.publicKey,
              vaultTokenAccount: vaultAddress,
              authorityTokenAccount: authorityTokenAccount,
              crank: authorityKeypair.publicKey,
            } as any)
            .signers([authorityKeypair])
            .rpc();

          reports.push(`[Crank API] Parametric market resolved successfully! Tx Sig: ${txSig}`);
          processedCount++;
        } catch (err: any) {
          reports.push(`[Crank API] Failed to resolve parametric market ${m.publicKey.toBase58()}: ${err.message}`);
        }
      }
    }

    reports.push(`[Crank API] Execution complete.`);
    return NextResponse.json({
      success: true,
      processed: processedCount,
      logs: reports
    });

  } catch (error: any) {
    reports.push(`[Crank API] Fatal processing error: ${error.message}`);
    return NextResponse.json({
      success: false,
      error: error.message,
      logs: reports
    }, { status: 500 });
  }
}
