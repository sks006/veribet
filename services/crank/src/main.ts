import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Keypair } from '@solana/web3.js';
import { SseClient } from './sse-client';
import { ProofHandler } from './proof-handler';
import { CrankSubmitter } from './crank-submitter';
import { TxLineEvent } from './types';
import * as anchor from '@coral-xyz/anchor';
import idlJson from '../../../target/idl/veribet.json';

// Load env
dotenv.config();

const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = process.env.PROGRAM_ID || '2Syq46YQQ4iGbCouFYxjeHEcABScMd669NAK5XrxZFWG';
const AUTHORITY_KEY_PATH = process.env.AUTHORITY_KEY_PATH || './authority-keypair.json';
const txlineBase = process.env.TXLINE_API_ORIGIN || 'https://txline-dev.txodds.com';
const TXLINE_URL = process.env.TXLINE_URL || `${txlineBase}/api/scores/stream`;
const ORACLE_PUBLIC_KEY = process.env.ORACLE_PUBLIC_KEY || 'mock';

function loadKeypair(path: string): Keypair {
  try {
    const raw = fs.readFileSync(path, 'utf8');
    const secretKey = Uint8Array.from(JSON.parse(raw));
    return Keypair.fromSecretKey(secretKey);
  } catch (err) {
    console.log(`[Crank Main] Keypair not found at ${path}. Generating a new temporary keypair...`);
    const kp = Keypair.generate();
    fs.writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
    return kp;
  }
}

async function main() {
  console.log('[Crank Main] Starting VeriBet Crank Service...');
  console.log(`[Crank Main] RPC URL: ${RPC_URL}`);
  console.log(`[Crank Main] Program ID: ${PROGRAM_ID}`);
  console.log(`[Crank Main] Oracle Pubkey: ${ORACLE_PUBLIC_KEY}`);

  const authorityKeypair = loadKeypair(AUTHORITY_KEY_PATH);
  console.log(`[Crank Main] Authority Pubkey: ${authorityKeypair.publicKey.toBase58()}`);

  // Instantiate Submitter
  const submitter = new CrankSubmitter(RPC_URL, PROGRAM_ID, authorityKeypair);

  // Set up connection for scanning
  const connection = new anchor.web3.Connection(RPC_URL, 'confirmed');
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(authorityKeypair), { commitment: 'confirmed' });
  const program = new anchor.Program(idlJson as any, provider) as any;

  // Try to load API token from txline-config.json
  let apiToken = process.env.TXLINE_API_TOKEN || '';
  try {
    const configPath = path.resolve(__dirname, '../../../../txline-config.json');
    const localConfigPath = path.resolve(process.cwd(), 'txline-config.json');
    const parentConfigPath = path.resolve(process.cwd(), '../txline-config.json');
    const workspaceConfigPath = path.resolve(process.cwd(), '../../txline-config.json');

    let resolvedPath = '';
    if (fs.existsSync(configPath)) resolvedPath = configPath;
    else if (fs.existsSync(localConfigPath)) resolvedPath = localConfigPath;
    else if (fs.existsSync(parentConfigPath)) resolvedPath = parentConfigPath;
    else if (fs.existsSync(workspaceConfigPath)) resolvedPath = workspaceConfigPath;

    if (resolvedPath) {
      const config = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
      if (config.apiToken) {
        apiToken = config.apiToken;
        console.log(`[Crank Main] Loaded TxLINE API Token from config file: ${resolvedPath}`);
      }
    }
  } catch (e: any) {
    console.error('[Crank Main] Error loading saved token:', e.message);
  }

  const headers: Record<string, string> = {
    'Accept': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Authorization': `Bearer ${process.env.TXLINE_GUEST_JWT || ''}`,
    'X-Api-Token': process.env.TXLINE_ACTIVATED_TOKEN || apiToken
  };

  if (!process.env.TXLINE_GUEST_JWT && apiToken) {
    headers['Authorization'] = `Bearer ${apiToken}`;
  }

  if (process.env.TXLINE_ACTIVATED_TOKEN || apiToken) {
    headers['x-api-key'] = process.env.TXLINE_ACTIVATED_TOKEN || apiToken;
  }

  // Stats cache for prop markets tracking
  interface PropStats {
    fouls: [number, number];
    redCards: [number, number];
    yellowCards: [number, number];
    corners: [number, number];
    freeKicks: [number, number];
    matchMinute: number;
  }

  const matchStatsCache: Record<string, PropStats> = {};

  const getStatValue = (stats: PropStats, eventType: number, team: number): number => {
    const teamIdx = team === 1 ? 1 : 0;
    switch (eventType) {
      case 0: return stats.fouls[teamIdx];
      case 1: return stats.redCards[teamIdx];
      case 2: return stats.yellowCards[teamIdx];
      case 3: return stats.corners[teamIdx];
      case 4: return stats.freeKicks[teamIdx];
      default: return 0;
    }
  };

  const evaluatePropResolution = (marketAccount: any, stats: PropStats): boolean => {
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
  };

  // Set up SSE client
  const sseClient = new SseClient(TXLINE_URL, headers);

  sseClient.onMessage(async (data: string) => {
    try {
      const event: TxLineEvent = JSON.parse(data);
      console.log(`[Crank Main] Received match event: ${event.matchId} | Status: ${event.status}`);

      // 1. Maintain running stats counter
      if (!matchStatsCache[event.matchId]) {
        matchStatsCache[event.matchId] = {
          fouls: [0, 0],
          redCards: [0, 0],
          yellowCards: [0, 0],
          corners: [0, 0],
          freeKicks: [0, 0],
          matchMinute: 0
        };
      }

      const stats = matchStatsCache[event.matchId];

      if (event.matchMinute !== undefined) {
        stats.matchMinute = event.matchMinute;
      } else {
        if (event.status === 'LIVE') {
          stats.matchMinute = Math.min(90, stats.matchMinute + 1);
        } else if (event.status === 'FINISHED') {
          stats.matchMinute = 90;
        }
      }

      if (event.eventType && event.team !== undefined) {
        const teamIdx = event.team === 1 ? 1 : 0;
        if (event.eventType === 'foul') stats.fouls[teamIdx]++;
        else if (event.eventType === 'red_card') stats.redCards[teamIdx]++;
        else if (event.eventType === 'yellow_card') stats.yellowCards[teamIdx]++;
        else if (event.eventType === 'corner') stats.corners[teamIdx]++;
        else if (event.eventType === 'free_kick') stats.freeKicks[teamIdx]++;
      } else {
        // Fallback simulated metrics when receiving generic updates
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

      // 2. Fetch and check Binary Prop Markets
      try {
        const allPropMarkets = await program.account.binaryPropMarket.all();
        const propMatched = allPropMarkets.filter((m: any) => {
          const mIdStr = Buffer.from(m.account.matchId)
            .toString('utf8')
            .replace(/\0/g, '');
          return mIdStr === event.matchId;
        });

        for (const m of propMatched) {
          // Check early close gating
          if (m.account.bettable && !m.account.resolved) {
            let shouldClose = false;
            const currentMinute = stats.matchMinute;
            
            if (m.account.window === 0 && currentMinute >= 35) {
              shouldClose = true;
            } else if (m.account.window === 1 && currentMinute >= 80) {
              shouldClose = true;
            } else if (m.account.window === 2 && currentMinute >= 0 && event.status !== 'SCHEDULED') {
              shouldClose = true;
            }

            if (shouldClose) {
              console.log(`[Crank Main] Early close triggered for market ${m.publicKey.toBase58()} (Minute ${currentMinute})`);
              try {
                await submitter.submitCloseBettingEarly(m.publicKey);
              } catch (err: any) {
                console.error(`[Crank Main] Failed to close betting early for ${m.publicKey.toBase58()}: ${err.message}`);
              }
            }
          }

          // Check resolution gating
          if (event.status === 'FINISHED' && !m.account.resolved) {
            const resolvedValue = evaluatePropResolution(m.account, stats);
            const proofHash = Array.from(ProofHandler.generateProofHash(event));
            console.log(`[Crank Main] Resolving prop market ${m.publicKey.toBase58()} to ${resolvedValue}`);
            try {
              await submitter.submitPropResolution(m.publicKey, m.account, resolvedValue, proofHash);
            } catch (err: any) {
              console.error(`[Crank Main] Failed to resolve prop market ${m.publicKey.toBase58()}: ${err.message}`);
            }
          }
        }
      } catch (err: any) {
        console.error(`[Crank Main] Error processing binary prop markets: ${err.message}`);
      }

      // 3. Process normal parametric markets
      if (event.status !== 'FINISHED') {
        return;
      }

      // Verify cryptographic signature for normal market resolution
      const isValid = ProofHandler.verifyProof(event, ORACLE_PUBLIC_KEY);
      if (!isValid) {
        console.warn(`[Crank Main] Invalid signature for event ${event.matchId}. Skipping normal resolution.`);
        return;
      }

      console.log(`[Crank Main] Proof verified for finished match ${event.matchId}. Scanning standard parametric markets...`);

      const allMarkets = await program.account.parametricMarket.all();
      const matched = allMarkets.filter((market: any) => {
        const matchIdStr = Buffer.from(market.account.matchIdBytes)
          .toString('utf8')
          .replace(/\0/g, '');
        return matchIdStr === event.matchId && !market.account.isResolved;
      });

      console.log(`[Crank Main] Found ${matched.length} unresolved standard markets for ${event.matchId}`);

      for (const market of matched) {
        const marketIdNum = market.account.marketId.toNumber();
        try {
          const txSig = await submitter.submitResolution(event, marketIdNum);
          if (txSig) {
            console.log(`[Crank Main] Successfully resolved market ID ${marketIdNum}. Tx: ${txSig}`);
          }
        } catch (err: any) {
          console.error(`[Crank Main] Failed to resolve market ${marketIdNum}: ${err.message}`);
        }
      }
    } catch (err: any) {
      console.error(`[Crank Main] Error processing message: ${err.message}`);
    }
  });

  // Start client
  sseClient.start();
}

main().catch((err) => {
  console.error('[Crank Main] Fatal Error:', err);
  process.exit(1);
});
