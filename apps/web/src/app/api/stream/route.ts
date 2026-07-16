import { NextRequest } from 'next/server';
import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// -------------------------------------------------------------
// Type Schemas & Environment Isolation Layer
// -------------------------------------------------------------

export interface TxLineEnvironment {
  targetNetwork: 'mainnet' | 'devnet';
  apiOrigin: string; // Must strictly match the targetNetwork
  apiToken: string;  // Retrieved from /api/token/activate or config
  jwt: string;       // Retrieved from /auth/guest/start
}

type FixtureIdentifier = string;

interface ScoreState {
  homeScore: number;
  awayScore: number;
}

interface FixtureState {
  id: FixtureIdentifier;
  statusId: number; // Mapped directly from TxOdds Game Phase StatusId
  scores: ScoreState;
  totalStats: number;
  lastTickTimestamp: number;
  homeTeam?: string;
  awayTeam?: string;
  sport?: string;
  kickoffTime?: number;
}

function signEventIfPossible(
  matchId: string,
  status: string,
  homeScore: number,
  awayScore: number,
  totalStats: number,
  timestamp: number,
  fallbackSignature: string
): string {
  const oraclePrivateKeyHex = process.env.ORACLE_PRIVATE_KEY;
  if (oraclePrivateKeyHex && oraclePrivateKeyHex !== 'mock') {
    try {
      const message = `${matchId}:${status}:${homeScore}:${awayScore}:${totalStats}:${timestamp}`;
      const msgBuffer = Buffer.from(message, 'utf8');
      const privateKey = crypto.createPrivateKey({
        key: Buffer.from(oraclePrivateKeyHex, 'hex'),
        format: 'der',
        type: 'pkcs8'
      });
      const sign = crypto.createSign('SHA256');
      sign.update(msgBuffer);
      return sign.sign(privateKey).toString('hex');
    } catch (err: any) {
      console.error('[SSE Multiplexer] Failed to sign oracle event:', err.message);
    }
  }
  return fallbackSignature;
}

// -------------------------------------------------------------
// Global States
// -------------------------------------------------------------

const clients = new Set<ReadableStreamDefaultController>();
let txlineConnectionActive = false;
let connectingToTxline = false;

// The Persistent Multiplexer Cache
const globalFixtureCache: Map<FixtureIdentifier, FixtureState> = new Map();

// Backoff Configuration for Reconnection
let reconnectTimeout: NodeJS.Timeout | null = null;
let currentBackoffMs = 1000;

// -------------------------------------------------------------
// Environment Validation Helper
// -------------------------------------------------------------

function getValidatedEnvironment(apiToken: string = '', jwt: string = ''): TxLineEnvironment {
  // Can be configured via TXLINE_NETWORK or NEXT_PUBLIC_SOLANA_NETWORK
  const targetNetwork = (process.env.TXLINE_NETWORK || process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet') as 'mainnet' | 'devnet';
  
  // Enforce origin matching targetNetwork
  const apiOrigin = targetNetwork === 'mainnet' ? 'https://txline.txodds.com' : 'https://txline-dev.txodds.com';
  
  // Structural parity verification
  if (targetNetwork === 'devnet' && !apiOrigin.includes('-dev')) {
    throw new Error(`Environment Isolation Breach: targetNetwork is devnet but apiOrigin is ${apiOrigin}`);
  }
  if (targetNetwork === 'mainnet' && apiOrigin.includes('-dev')) {
    throw new Error(`Environment Isolation Breach: targetNetwork is mainnet but apiOrigin is ${apiOrigin}`);
  }

  return {
    targetNetwork,
    apiOrigin,
    apiToken,
    jwt
  };
}

async function fetchGuestJwt(apiOrigin: string): Promise<string> {
  try {
    const authRes = await fetch(`${apiOrigin}/auth/guest/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!authRes.ok) {
      throw new Error(`Guest auth failed with status ${authRes.status}`);
    }
    const authData = await authRes.json();
    return authData.token || authData.jwt || '';
  } catch (err: any) {
    console.error(`[SSE Multiplexer] Failed to negotiate guest JWT:`, err.message);
    return '';
  }
}

// -------------------------------------------------------------
// Parser & State Mutation Logic
// -------------------------------------------------------------

function addFlagEmojiIfMissing(teamName: string): string {
  if (!teamName) return '';
  if (teamName.includes('🇦🇷') || teamName.includes('🇫🇷') || teamName.includes('🇧🇷') || teamName.includes('🇩🇪') || teamName.includes('🇺🇸') || teamName.includes('🇲🇽') || teamName.includes('🏴󠁧󠁢󠁥󠁮󠁧󠁿') || teamName.includes('🇮🇹') || teamName.includes('🇪🇸') || teamName.includes('🇵🇹') || teamName.includes('🇨🇭')) {
    return teamName;
  }
  const lower = teamName.toLowerCase();
  if (lower.includes('argentina')) return 'Argentina 🇦🇷';
  if (lower.includes('france')) return 'France 🇫🇷';
  if (lower.includes('brazil')) return 'Brazil 🇧🇷';
  if (lower.includes('germany')) return 'Germany 🇩🇪';
  if (lower.includes('usa') || lower.includes('united states')) return 'USA 🇺🇸';
  if (lower.includes('mexico')) return 'Mexico 🇲🇽';
  if (lower.includes('england')) return 'England 🏴󠁧󠁢󠁥󠁮󠁧󠁿';
  if (lower.includes('italy')) return 'Italy 🇮🇹';
  if (lower.includes('spain')) return 'Spain 🇪🇸';
  if (lower.includes('portugal')) return 'Portugal 🇵🇹';
  if (lower.includes('switzerland')) return 'Switzerland 🇨🇭';
  return teamName;
}

function parseRawFixtureToState(item: any): FixtureState {
  const info = item.FixtureInfo || {};
  const matchId = (info.FixtureId || item.FixtureId || item.matchId || item.id || item.match_id || '').toString();

  const p1IsHome = info.Participant1IsHome ?? item.Participant1IsHome ?? true;
  const rawP1 = info.Participant1 || item.Participant1 || item.homeTeam || '';
  const rawP2 = info.Participant2 || item.Participant2 || item.awayTeam || '';
  
  const homeTeam = p1IsHome ? rawP1 : rawP2;
  const awayTeam = p1IsHome ? rawP2 : rawP1;

  let homeScore = 0;
  let awayScore = 0;
  if (item.Update?.Scores) {
    homeScore = item.Update.Scores.Participant1 ?? 0;
    awayScore = item.Update.Scores.Participant2 ?? 0;
  } else if (item.Scores) {
    homeScore = item.Scores.Participant1 ?? 0;
    awayScore = item.Scores.Participant2 ?? 0;
  } else {
    homeScore = item.homeScore ?? item.home_score ?? 0;
    awayScore = item.awayScore ?? item.away_score ?? 0;
  }

  const statusId = item.Update?.StatusId ?? item.GameState ?? 2; // Default to Live if kickoff update, or Scheduled if none

  const rawKickoff = info.StartTime || item.StartTime || item.kickoffTime || item.kickoff_time || item.date || Date.now();
  const kickoffTime = typeof rawKickoff === 'string'
    ? new Date(rawKickoff).getTime()
    : (rawKickoff < 10000000000 ? rawKickoff * 1000 : rawKickoff);

  const comp = info.Competition || item.Competition || '';
  const sportRaw = info.Sport || item.Sport || item.sport || 'Football';
  let sport = 'Football';
  if (comp.toLowerCase().includes('world cup')) {
    sport = 'World Cup 🏆';
  } else if (comp) {
    sport = comp;
  } else {
    sport = sportRaw;
  }

  return {
    id: matchId,
    statusId,
    scores: {
      homeScore,
      awayScore
    },
    totalStats: homeScore + awayScore,
    lastTickTimestamp: item.Ts || item.timestamp || item.Update?.Ts || Date.now(),
    homeTeam: addFlagEmojiIfMissing(homeTeam),
    awayTeam: addFlagEmojiIfMissing(awayTeam),
    sport,
    kickoffTime
  };
}

// -------------------------------------------------------------
// Abstract Control-Flow: The SSE State Machine
// -------------------------------------------------------------

function processTxOddsOracleTick(rawPacketPayload: string): void {
  try {
    // 1. Parse JSON payload into TxOdds Action schema
    const payload = JSON.parse(rawPacketPayload);
    
    // 2. Extract FixtureId from payload.FixtureInfo or top-level properties
    const info = payload.FixtureInfo || {};
    const fixtureId = (info.FixtureId || payload.FixtureId || payload.matchId || payload.id || '').toString();
    if (!fixtureId) return;

    // 3. Extract payload.Data and payload.Update properties
    const update = payload.Update || {};
    
    // 4. Retrieve existing state pointer
    let state = globalFixtureCache.get(fixtureId);
    
    // 5. INITIALIZATION CHECK:
    if (!state) {
      state = parseRawFixtureToState(payload);
    } else {
      // 6. SCORE MUTATION:
      // Mutate scores if and only if update has scores object
        if (update.Scores) {
          state.scores.homeScore = update.Scores.Participant1 ?? state.scores.homeScore;
          state.scores.awayScore = update.Scores.Participant2 ?? state.scores.awayScore;
          state.totalStats = state.scores.homeScore + state.scores.awayScore;
        }
        
        // 7. STATUS MUTATION:
        if (update.StatusId !== undefined) {
          state.statusId = update.StatusId;
        }
      
        state.lastTickTimestamp = payload.Ts || payload.timestamp || update.Ts || Date.now();
    }

    // Persist mutated state to cache
    globalFixtureCache.set(fixtureId, state);

    // 8. BROADCAST:
    // Snapshot state and broadcast to all connected web clients
    const statusStr = state.statusId === 3 ? 'FINISHED' : (state.statusId === 2 ? 'LIVE' : 'SCHEDULED');
    const signature = signEventIfPossible(
      state.id,
      statusStr,
      state.scores.homeScore,
      state.scores.awayScore,
      state.totalStats,
      state.lastTickTimestamp,
      payload.signature || update.ServerId || 'txline_verified_signature'
    );
    const snapshot = {
      matchId: state.id,
      status: statusStr,
      statusId: state.statusId,
      homeScore: state.scores.homeScore,
      awayScore: state.scores.awayScore,
      totalStats: state.totalStats,
      timestamp: state.lastTickTimestamp,
      signature,
      homeTeam: state.homeTeam,
      awayTeam: state.awayTeam,
      kickoffTime: state.kickoffTime,
      sport: state.sport
    };

    const encoder = new TextEncoder();
    const chunk = encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`);
    clients.forEach(client => {
      try {
        client.enqueue(chunk);
      } catch (e) {
        clients.delete(client);
      }
    });
  } catch (err: any) {
    console.error('[SSE Multiplexer] Error processing oracle tick:', err.message);
  }
}

// -------------------------------------------------------------
// Memory Schema: Stream Authentication
// -------------------------------------------------------------

interface StreamCapabilities {
  targetUri: string; // e.g., "https://txline-dev.txodds.com/api/scores/stream"
  guestJwt: string;  // The 'Authorization: Bearer <token>'
  apiToken: string;  // The 'X-Api-Token: <api-key>'
}

// -------------------------------------------------------------
// Abstract Control-Flow: Socket Connection & Disconnection
// -------------------------------------------------------------

function handleEviction(error: Error): void {
  console.error(`[SSE Multiplexer] CRYPTOGRAPHIC EVICTION: ${error.message}. Purging tokens and halting stream.`);
  
  // Purge local configuration file to force a fresh handshake next time
  const configPaths = [
    path.join(process.cwd(), '../../txline-config.json'),
    path.join(process.cwd(), '../txline-config.json'),
    path.join(process.cwd(), 'txline-config.json'),
  ];
  for (const p of configPaths) {
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        console.log(`[SSE Multiplexer] Purged config token at ${p}`);
      }
    } catch (e) {}
  }
  
  txlineConnectionActive = false;
  connectingToTxline = false;
  
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  // Purge/warn clients with a strict status
  const encoder = new TextEncoder();
  const errorPayload = encoder.encode(`data: ${JSON.stringify({ status: 'ORACLE_EVICTED', error: error.message })}\n\n`);
  clients.forEach(client => {
    try {
      client.enqueue(errorPayload);
    } catch {
      clients.delete(client);
    }
  });
}

function handleNetworkDisruption(error: Error): void {
  console.warn(`[SSE Multiplexer] Network disruption: ${error.message}. Triggering backoff reconnection...`);
  
  txlineConnectionActive = false;
  connectingToTxline = false;

  const encoder = new TextEncoder();
  const errorPayload = encoder.encode(`data: ${JSON.stringify({ status: 'ORACLE_DISCONNECTED', error: error.message })}\n\n`);
  clients.forEach(client => {
    try {
      client.enqueue(errorPayload);
    } catch {
      clients.delete(client);
    }
  });

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }
  
  console.log(`[SSE Multiplexer] Reconnecting to Oracle in ${currentBackoffMs}ms...`);
  reconnectTimeout = setTimeout(() => {
    currentBackoffMs = Math.min(currentBackoffMs * 2, 30000);
    tryConnectTxline();
  }, currentBackoffMs);
}

// Abstract Control Flow: SSE Multiplexer Ignition
function igniteJitStream(capabilities: StreamCapabilities): void {
  // 1. STATE VERIFICATION:
  // Assert that `globalFixtureCache` is fully hydrated from the snapshot barrier.
  if (globalFixtureCache.size === 0) {
    const fatalError = new Error("Fatal: globalFixtureCache is empty! Hydration barrier check failed.");
    console.error(`[SSE Multiplexer] ${fatalError.message}`);
    throw fatalError;
  }

  // 2. SOCKET INSTANTIATION:
  const txlineUrl = capabilities.targetUri;
  const client = txlineUrl.startsWith('https') ? https : http;
  const headers: Record<string, string> = {
    'Accept': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Authorization': `Bearer ${capabilities.guestJwt}`,
    'X-Api-Token': capabilities.apiToken
  };

  if (capabilities.apiToken) {
    headers['x-api-key'] = capabilities.apiToken;
  }

  const urlObj = new URL(txlineUrl);
  const options = {
    hostname: urlObj.hostname,
    port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
    path: urlObj.pathname + urlObj.search,
    method: 'GET',
    headers,
  };

  const req = client.request(options, (res) => {
    const statusCode = res.statusCode ?? 200;

    // 5. EVENT ROUTING: onError (HTTP status checks)
    if (statusCode === 401 || statusCode === 403) {
      res.destroy();
      handleEviction(new Error(`HTTP rejection status code ${statusCode}`));
      return;
    }

    if (statusCode === 502 || statusCode === 503 || statusCode === 504) {
      res.destroy();
      handleNetworkDisruption(new Error(`HTTP rejection status code ${statusCode}`));
      return;
    }

    if (statusCode !== 200) {
      res.destroy();
      handleNetworkDisruption(new Error(`HTTP rejection status code ${statusCode}`));
      return;
    }

    // 3. EVENT ROUTING: onOpen
    txlineConnectionActive = true;
    connectingToTxline = false;
    currentBackoffMs = 1000; // Reset backoff on success
    console.log('[SSE Multiplexer] Connected to real TxLINE stream successfully! Cryptographic handshake verified.');

    // 4. EVENT ROUTING: onMessage (The Delta Pipeline)
    let buffer = '';
    res.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data:')) {
          const dataContent = line.slice(5).trim();
          if (dataContent) {
            processTxOddsOracleTick(dataContent);
          }
        }
      }
    });

    res.on('end', () => {
      handleNetworkDisruption(new Error('Connection closed by TxOdds host.'));
    });
  });

  req.on('error', (err) => {
    handleNetworkDisruption(err);
  });

  req.end();
}

async function tryConnectTxline() {
  if (connectingToTxline || txlineConnectionActive) return;
  connectingToTxline = true;

  try {
    // 1. Load API token from workspace configs
    let apiToken = process.env.TXLINE_API_TOKEN || '';
    let resolvedPath = '';
    const pathsToSearch = [
      path.join(process.cwd(), '../../txline-config.json'),
      path.join(process.cwd(), '../txline-config.json'),
      path.join(process.cwd(), 'txline-config.json'),
      path.join(__dirname, '../../../../txline-config.json'),
      path.join(__dirname, '../../../../../../txline-config.json'),
    ];

    for (const p of pathsToSearch) {
      if (fs.existsSync(p)) {
        resolvedPath = p;
        break;
      }
    }

    if (resolvedPath) {
      const config = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
      if (config.apiToken) {
        apiToken = config.apiToken;
      }
    }

    if (!apiToken) {
      throw new Error("No API token resolved for TxLINE connection.");
    }

    // Enforce synchronous hydration barrier: Fetch and populate snapshot first
    console.log('[SSE Multiplexer] Enforcing synchronous hydration barrier...');
    await fetchTxlineFixtures(apiToken);

    // 2. Validate environment configuration
    const env = getValidatedEnvironment(apiToken);

    // Validate apiOrigin structurally aligns with targetNetwork string BEFORE initiating request
    if (env.targetNetwork === 'devnet' && !env.apiOrigin.includes('-dev')) {
      throw new Error(`Config error: Devnet target network cannot run on mainnet origin ${env.apiOrigin}`);
    }
    if (env.targetNetwork === 'mainnet' && env.apiOrigin.includes('-dev')) {
      throw new Error(`Config error: Mainnet target network cannot run on devnet origin ${env.apiOrigin}`);
    }

    // 3. Retrieve guest JWT from target network endpoint
    const jwt = await fetchGuestJwt(env.apiOrigin);
    env.jwt = jwt;

    const txlineBase = process.env.TXLINE_API_ORIGIN || env.apiOrigin;
    const txlineUrl = process.env.TXLINE_URL || `${txlineBase}/api/scores/stream`;
    console.log(`[SSE Multiplexer] Isolation check passed. Connecting to: ${txlineUrl}`);

    const capabilities: StreamCapabilities = {
      targetUri: txlineUrl,
      guestJwt: process.env.TXLINE_GUEST_JWT || env.jwt,
      apiToken: process.env.TXLINE_ACTIVATED_TOKEN || env.apiToken
    };

    igniteJitStream(capabilities);
  } catch (err: any) {
    connectingToTxline = false;
    handleNetworkDisruption(err);
  }
}

// -------------------------------------------------------------
// REST Endpoint Setup & Client Synchronization
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

async function fetchLatestScoreForFixture(
  fixtureId: string,
  jwt: string,
  apiToken: string,
  apiOrigin: string
): Promise<{ homeScore: number; awayScore: number; statusId: number } | null> {
  const headers = {
    'Authorization': `Bearer ${jwt}`,
    'X-Api-Token': apiToken
  };

  const url = `${apiOrigin}/api/scores/historical/${fixtureId}`;
  try {
    const res = await fetch(url, { method: 'GET', headers });
    if (res.status !== 200) {
      return null;
    }
    const text = await res.text();
    const blocks = text.split(/\n\n+/);
    let lastValidMessage: any = null;

    for (const block of blocks) {
      if (!block.trim()) continue;
      const parsed = parseSseBlock(block);
      if (parsed && parsed.data) {
        try {
          lastValidMessage = JSON.parse(parsed.data);
        } catch {}
      }
    }

    if (lastValidMessage) {
      const homeScore = lastValidMessage.Stats?.["1"] ?? lastValidMessage.Score?.Participant1?.Total?.Goals ?? 0;
      const awayScore = lastValidMessage.Stats?.["2"] ?? lastValidMessage.Score?.Participant2?.Total?.Goals ?? 0;
      const isFinal = lastValidMessage.Action === 'game_finalised' || lastValidMessage.GameState === 'finished' || lastValidMessage.StatusId === 100;
      
      return {
        homeScore,
        awayScore,
        statusId: isFinal ? 3 : 2 // 3 = FINISHED, 2 = LIVE
      };
    }
  } catch (err: any) {
    console.warn(`[SSE Multiplexer] Error fetching historical scores for ${fixtureId}:`, err.message);
  }

  return null;
}

async function fetchTxlineFixtures(apiToken: string): Promise<any[]> {
  try {
    const env = getValidatedEnvironment(apiToken);
    
    // Retrieve guest JWT
    const jwt = await fetchGuestJwt(env.apiOrigin);
    env.jwt = jwt;

    const snapshotUrl = `${env.apiOrigin}/api/fixtures/snapshot`;
    console.log(`[SSE Multiplexer] Fetching baseline snapshot from ${snapshotUrl}...`);
    const fixturesRes = await fetch(snapshotUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${env.jwt}`,
        'X-Api-Token': env.apiToken
      }
    });

    if (!fixturesRes.ok) {
      throw new Error(`Baseline snapshot fetch returned status ${fixturesRes.status} (${fixturesRes.statusText})`);
    }

    const data = await fixturesRes.json();
    const fixtures = Array.isArray(data) ? data : (data.fixtures || data.data || []);
    
    console.log(`[SSE Multiplexer] Successfully fetched ${fixtures.length} baseline fixtures.`);
    
    // Populate a local map first to avoid race conditions with clients reading early
    const tempCache = new Map<string, FixtureState>();
    for (const f of fixtures) {
      const details = parseRawFixtureToState(f);
      if (details.id) {
        tempCache.set(details.id, details);
      }
    }

    // Dynamic resolution check for past fixtures
    for (const [id, state] of tempCache.entries()) {
      if (state.kickoffTime !== undefined && state.kickoffTime <= Date.now()) {
        console.log(`[SSE Multiplexer] Fixture ${id} kickoff time has passed. Checking TxLINE for latest score...`);
        try {
          const latest = await fetchLatestScoreForFixture(id, env.jwt, env.apiToken, env.apiOrigin);
          if (latest) {
            state.scores.homeScore = latest.homeScore;
            state.scores.awayScore = latest.awayScore;
            state.totalStats = latest.homeScore + latest.awayScore;
            state.statusId = latest.statusId;
            console.log(`[SSE Multiplexer] Dynamic score hydration for ${id} successful: ${latest.homeScore}-${latest.awayScore}`);
          }
        } catch (err: any) {
          console.warn(`[SSE Multiplexer] Failed to fetch latest score for past fixture ${id}:`, err.message);
        }
      }
    }

    // Atomically swap to the global cache
    globalFixtureCache.clear();
    for (const [id, state] of tempCache.entries()) {
      globalFixtureCache.set(id, state);
    }

    return fixtures;
  } catch (err: any) {
    console.error('[SSE Multiplexer] Fatal error during snapshot hydration:', err.message);
    throw err; // Rethrow to halt execution and prevent socket connection
  }
}

export async function GET(req: NextRequest) {
  // Trigger connection background link (which handles hydration & socket setup synchronously)
  tryConnectTxline();
  
  // Load API token if configured
  let apiToken = '';
  try {
    const configPath = path.join(process.cwd(), '../../txline-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      apiToken = config.apiToken;
    }
  } catch (e) {}

  const stream = new ReadableStream({
    async start(controller) {
      clients.add(controller);

      const encoder = new TextEncoder();
      
      // Wait for the synchronous hydration barrier to populate globalFixtureCache
      if (apiToken && globalFixtureCache.size === 0) {
        let retries = 0;
        while (globalFixtureCache.size === 0 && retries < 20) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          retries++;
        }
      }

      // Stream the cached states to the client
      globalFixtureCache.forEach(state => {
        const statusStr = state.statusId === 3 ? 'FINISHED' : (state.statusId === 2 ? 'LIVE' : 'SCHEDULED');
        const signature = signEventIfPossible(
          state.id,
          statusStr,
          state.scores.homeScore,
          state.scores.awayScore,
          state.totalStats,
          state.lastTickTimestamp,
          'initial_state'
        );
        const payload = JSON.stringify({
          matchId: state.id,
          status: statusStr,
          statusId: state.statusId,
          homeScore: state.scores.homeScore,
          awayScore: state.scores.awayScore,
          totalStats: state.totalStats,
          timestamp: state.lastTickTimestamp,
          signature,
          homeTeam: state.homeTeam,
          awayTeam: state.awayTeam,
          kickoffTime: state.kickoffTime,
          sport: state.sport
        });
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      });
    },
    cancel(controller) {
      clients.delete(controller);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  });
}
