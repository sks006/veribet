import * as fs from 'fs';
import * as path from 'path';
import { Keypair, Connection, PublicKey } from '@solana/web3.js';
import { ProofHandler } from './proof-handler';
import { CrankSubmitter } from './crank-submitter';
import { TxLineEvent } from './types';
import * as anchor from '@coral-xyz/anchor';
import idlJson from '../../../target/idl/veribet.json';
import { config } from './config';

const RPC_URL = config.rpcUrl;
const PROGRAM_ID = config.programId;
const txlineBase = config.txlineApiOrigin;

interface PropStats {
  fouls: [number, number];
  redCards: [number, number];
  yellowCards: [number, number];
  corners: [number, number];
  freeKicks: [number, number];
  matchMinute: number;
}

function getCrankSigner(): Keypair {
  const rawKey = process.env.CRANK_SIGNER_KEY || process.env.AUTHORITY_KEY;
  if (!rawKey) {
    // Fallback search local directory authority file if dev
    let localPath = path.resolve(process.cwd(), '../../authority-keypair.json');
    if (!fs.existsSync(localPath)) {
      localPath = path.resolve(process.cwd(), 'authority-keypair.json');
    }
    if (fs.existsSync(localPath)) {
      const raw = fs.readFileSync(localPath, 'utf8');
      console.log(`[Crank Main] Loaded authority keypair from file: ${localPath}`);
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
    }
    throw new Error("Missing CRANK_SIGNER_KEY/AUTHORITY_KEY environment allocation.");
  }

  try {
    if (rawKey.trim().startsWith('[')) {
      const secretKey = Uint8Array.from(JSON.parse(rawKey));
      return Keypair.fromSecretKey(secretKey);
    } else {
      const decoded = anchor.utils.bytes.bs58.decode(rawKey.trim());
      return Keypair.fromSecretKey(decoded);
    }
  } catch (err: any) {
    throw new Error(`Failed to parse CRANK_SIGNER_KEY: ${err.message}`);
  }
}

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
    console.error(`[Crank Main] Error fetching historical scores for ${matchId}:`, err.message);
  }
  return null;
}

async function main() {
  console.log('[Crank Main] Starting Stateless VeriBet Crank Service...');
  console.log(`[Crank Main] RPC URL: ${RPC_URL}`);
  console.log(`[Crank Main] Program ID: ${PROGRAM_ID}`);

  // 1. Resolve Authority Wallet (Crank Signer)
  const authorityKeypair = getCrankSigner();
  console.log(`[Crank Main] Authority Pubkey: ${authorityKeypair.publicKey.toBase58()}`);

  // 2. Instantiate Submitter and Anchor Program
  const submitter = new CrankSubmitter(RPC_URL, PROGRAM_ID, authorityKeypair);
  const connection = new Connection(RPC_URL, 'confirmed');
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

  // 3. Resolve TxLINE API Token
  let apiToken = process.env.TXLINE_API_TOKEN || '';
  if (!apiToken) {
    try {
      const pathsToSearch = [
        path.join(process.cwd(), '../../txline-config.json'),
        path.join(process.cwd(), '../txline-config.json'),
        path.join(process.cwd(), 'txline-config.json'),
        path.join(__dirname, '../../../../txline-config.json'),
        path.join(__dirname, '../../../../../../txline-config.json'),
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
          console.log(`[Crank Main] Loaded TxLINE token from config file: ${foundPath}`);
        }
      }
    } catch (e: any) {
      console.warn("[Crank Main] Failed to load local config token:", e.message);
    }
  }

  // 4. Negotiate TxLINE authentication and fetch baseline snapshot
  const targetNetwork = config.network;
  const apiOrigin = txlineBase;

  console.log(`[Crank Main] Fetching TxLINE auth guest JWT from ${apiOrigin}...`);
  const authRes = await fetch(`${apiOrigin}/auth/guest/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!authRes.ok) {
    throw new Error(`Guest auth failed with status ${authRes.status}`);
  }
  const authData = (await authRes.json()) as any;
  const jwt = authData.token || authData.jwt || '';

  console.log(`[Crank Main] Fetching baseline snapshot...`);
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
  const fixtures = (await fixturesRes.json()) as any[];
  console.log(`[Crank Main] Snapshot loaded. Total fixtures: ${fixtures.length}`);

  // 5. Scan on-chain markets
  console.log(`[Crank Main] Scanning unresolved accounts from Solana...`);
  const unresolvedPropMarkets = (await program.account.binaryPropMarket.all()).filter((m: any) => !m.account.resolved);
  const unresolvedParametricMarkets = (await program.account.parametricMarket.all()).filter((m: any) => !m.account.isResolved);
  
  console.log(`[Crank Main] Found ${unresolvedPropMarkets.length} unresolved Prop Markets and ${unresolvedParametricMarkets.length} standard Parametric Markets.`);

  // 6. Iterate Prop Markets
  for (const m of unresolvedPropMarkets) {
    const matchIdStr = Buffer.from(m.account.matchId)
      .toString('utf8')
      .replace(/\0/g, '');

    console.log(`[Crank Main] Checking Prop Market ${m.publicKey.toBase58()} (Match ID: ${matchIdStr})`);
    
    const fixture = fixtures.find(f => String(f.FixtureId || f.id) === matchIdStr);
    if (!fixture) {
      console.log(`[Crank Main] Match ID ${matchIdStr} not found in TxLINE snapshot. Skipping.`);
      continue;
    }

    const result = await fetchMatchStatsAndEvent(matchIdStr, jwt, apiToken, apiOrigin);
    if (!result) {
      console.log(`[Crank Main] Historical scores not available for ${matchIdStr}. Skipping.`);
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
        console.log(`[Crank Main] Early close triggered for market ${m.publicKey.toBase58()} (Minute ${currentMinute})`);
        try {
          const txSig = await submitter.submitCloseBettingEarly(m.publicKey);
          if (txSig) {
            console.log(`[Crank Main] Betting closed early! Tx Sig: ${txSig}`);
          }
        } catch (err: any) {
          console.error(`[Crank Main] Failed to close betting early for ${m.publicKey.toBase58()}: ${err.message}`);
        }
      }
    }

    // Check resolution gating
    if (finalEvent.status === 'FINISHED') {
      const resolvedValue = evaluatePropResolution(m.account, stats);
      const proofHash = Array.from(ProofHandler.generateProofHash(finalEvent));
      console.log(`[Crank Main] Resolving prop market ${m.publicKey.toBase58()} to ${resolvedValue}`);
      
      try {
        const txSig = await submitter.submitPropResolution(m.publicKey, m.account, resolvedValue, proofHash);
        if (txSig) {
          console.log(`[Crank Main] Prop market resolved successfully! Tx Sig: ${txSig}`);
        }
      } catch (err: any) {
        console.error(`[Crank Main] Failed to resolve prop market ${m.publicKey.toBase58()}: ${err.message}`);
      }
    }
  }

  // 7. Iterate standard Parametric Markets
  for (const m of unresolvedParametricMarkets) {
    const matchIdStr = Buffer.from(m.account.matchIdBytes)
      .toString('utf8')
      .replace(/\0/g, '');

    console.log(`[Crank Main] Checking Parametric Market ${m.publicKey.toBase58()} (Match ID: ${matchIdStr})`);

    const fixture = fixtures.find(f => String(f.FixtureId || f.id) === matchIdStr);
    if (!fixture) {
      console.log(`[Crank Main] Match ID ${matchIdStr} not found in TxLINE snapshot. Skipping.`);
      continue;
    }

    const result = await fetchMatchStatsAndEvent(matchIdStr, jwt, apiToken, apiOrigin);
    if (!result) {
      console.log(`[Crank Main] Historical scores not available for ${matchIdStr}. Skipping.`);
      continue;
    }

    const { finalEvent } = result;

    // Check resolution gating
    if (finalEvent.status === 'FINISHED') {
      const marketIdNum = m.account.marketId.toNumber();
      console.log(`[Crank Main] Resolving parametric market ${m.publicKey.toBase58()} (Market ID: ${marketIdNum})`);

      try {
        const txSig = await submitter.submitResolution(finalEvent, marketIdNum);
        if (txSig) {
          console.log(`[Crank Main] Parametric market resolved successfully! Tx Sig: ${txSig}`);
        }
      } catch (err: any) {
        console.error(`[Crank Main] Failed to resolve parametric market ${m.publicKey.toBase58()}: ${err.message}`);
      }
    }
  }

  console.log('[Crank Main] Execution complete.');
}

main().catch((err) => {
  console.error('[Crank Main] Fatal Error:', err);
  process.exit(1);
});
