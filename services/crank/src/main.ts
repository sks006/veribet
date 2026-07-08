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
const TXLINE_URL = process.env.TXLINE_URL || 'https://txline-dev.txodds.com/stream';
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
  const program = new anchor.Program(idlJson as any, provider);

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

  const headers: Record<string, string> = {};
  if (apiToken) {
    headers['Authorization'] = `Bearer ${apiToken}`;
    headers['x-api-key'] = apiToken;
  }

  // Set up SSE client
  const sseClient = new SseClient(TXLINE_URL, headers);

  sseClient.onMessage(async (data: string) => {
    try {
      const event: TxLineEvent = JSON.parse(data);
      console.log(`[Crank Main] Received match event: ${event.matchId} | Status: ${event.status}`);

      if (event.status !== 'FINISHED') {
        console.log(`[Crank Main] Match ${event.matchId} is ${event.status}. Skipping resolution...`);
        return;
      }

      // Verify cryptographic signature
      const isValid = ProofHandler.verifyProof(event, ORACLE_PUBLIC_KEY);
      if (!isValid) {
        console.warn(`[Crank Main] Invalid signature for event ${event.matchId}. Dropping event.`);
        return;
      }

      console.log(`[Crank Main] Proof verified for finished match ${event.matchId}. Scanning on-chain markets...`);

      // Scan all markets on-chain for the match ID
      const allMarkets = await program.account.parametricMarket.all();
      const matched = allMarkets.filter((market) => {
        const matchIdStr = Buffer.from(market.account.matchIdBytes)
          .toString('utf8')
          .replace(/\0/g, ''); // strip trailing null bytes
        return matchIdStr === event.matchId && !market.account.isResolved;
      });

      console.log(`[Crank Main] Found ${matched.length} unresolved matching markets for ${event.matchId}`);

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
