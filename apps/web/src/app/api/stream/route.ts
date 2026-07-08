import { NextRequest } from 'next/server';
import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';

const clients = new Set<ReadableStreamDefaultController>();
let txlineConnectionActive = false;

// Mock matches fallback data for simulation
let matchesSimulated = [
  { id: 'ARG-FRA-WC26', homeTeam: 'Argentina 🇦🇷', awayTeam: 'France 🇫🇷', status: 'LIVE', homeScore: 2, awayScore: 2, totalStats: 4, kickoffTime: Date.now() - 2700000, sport: 'World Cup 🏆' },
  { id: 'BRA-GER-WC26', homeTeam: 'Brazil 🇧🇷', awayTeam: 'Germany 🇩🇪', status: 'LIVE', homeScore: 1, awayScore: 0, totalStats: 1, kickoffTime: Date.now() - 900000, sport: 'World Cup 🏆' },
  { id: 'USA-MEX-WC26', homeTeam: 'USA 🇺🇸', awayTeam: 'Mexico 🇲🇽', status: 'SCHEDULED', homeScore: 0, awayScore: 0, totalStats: 0, kickoffTime: Date.now() + 1800000, sport: 'World Cup 🏆' },
  { id: 'LIV-MCI-2026', homeTeam: 'Liverpool', awayTeam: 'Man City', status: 'LIVE', homeScore: 1, awayScore: 1, totalStats: 2, kickoffTime: Date.now() - 1800000, sport: 'Football' },
  { id: 'CHE-ARS-2026', homeTeam: 'Chelsea', awayTeam: 'Arsenal', status: 'SCHEDULED', homeScore: 0, awayScore: 0, totalStats: 0, kickoffTime: Date.now() + 600000, sport: 'Football' },
  { id: 'LAL-BOS-2026', homeTeam: 'LA Lakers', awayTeam: 'Boston Celtics', status: 'LIVE', homeScore: 92, awayScore: 95, totalStats: 187, kickoffTime: Date.now() - 3600000, sport: 'Basketball' }
];

let simStarted = false;
let simInterval: NodeJS.Timeout | null = null;

function startSimulation() {
  const useMock = process.env.USE_MOCK_SIMULATION !== 'false';
  if (!useMock) {
    console.log('[SSE Multiplexer] Simulation disabled by USE_MOCK_SIMULATION=false flag.');
    return;
  }
  if (simStarted || txlineConnectionActive) return;
  simStarted = true;
  console.log('[SSE Multiplexer] Starting fallback match event simulation...');

  simInterval = setInterval(() => {
    if (txlineConnectionActive) return;

    matchesSimulated = matchesSimulated.map(m => {
      if (m.status === 'LIVE') {
        const increment = Math.random() > 0.7;
        if (increment) {
          const homeInc = Math.random() > 0.5 ? 1 : 0;
          const awayInc = homeInc === 0 ? 1 : 0;
          const newHome = m.homeScore + homeInc;
          const newAway = m.awayScore + awayInc;
          const totalStats = m.sport === 'Football' ? (newHome + newAway) : (newHome + newAway);
          const status = Math.random() > 0.96 ? 'FINISHED' as const : 'LIVE' as const;

          const updated = { ...m, homeScore: newHome, awayScore: newAway, totalStats, status };
          broadcast(updated);
          return updated;
        }
      } else if (m.status === 'SCHEDULED') {
        if (Math.random() > 0.95) {
          const updated = { ...m, status: 'LIVE' as const };
          broadcast(updated);
          return updated;
        }
      }
      return m;
    });
  }, 5000);
}

function stopSimulation() {
  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
  }
  simStarted = false;
}

function broadcast(match: any) {
  const data = JSON.stringify({
    matchId: match.id,
    status: match.status,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    totalStats: match.totalStats,
    timestamp: Date.now(),
    signature: 'mock_signature_from_txline_oracle_verified_on_chain'
  });

  const encoder = new TextEncoder();
  const chunk = encoder.encode(`data: ${data}\n\n`);

  clients.forEach(client => {
    try {
      client.enqueue(chunk);
    } catch (e) {
      clients.delete(client);
    }
  });
}

let connectingToTxline = false;
function tryConnectTxline() {
  if (connectingToTxline || txlineConnectionActive) return;
  connectingToTxline = true;

  const txlineOrigin = process.env.TXLINE_API_ORIGIN || 'https://txline.txodds.com';
  const txlineUrl = process.env.TXLINE_URL || `${txlineOrigin}/stream`;
  console.log(`[SSE Multiplexer] Trying to connect to real TxLINE stream at: ${txlineUrl}`);

  const useMock = process.env.USE_MOCK_SIMULATION !== 'false';
  const client = txlineUrl.startsWith('https') ? https : http;

  const headers: Record<string, string> = {
    'Accept': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  };

  let token = process.env.TXLINE_JWT || process.env.TXLINE_API_TOKEN;
  try {
    const configPath = path.join(process.cwd(), '../../txline-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.apiToken) {
        token = config.apiToken;
      }
    }
  } catch (e) {
    console.error('[SSE Multiplexer] Error loading saved token:', e);
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['x-api-key'] = token;
  }

  try {
    const urlObj = new URL(txlineUrl);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers,
    };

    const req = client.request(options, (res) => {
      if (res.statusCode !== 200) {
        console.error(`[SSE Multiplexer] Received status code ${res.statusCode} from TxLINE stream.`);
        connectingToTxline = false;
        if (useMock) startSimulation();
        return;
      }
      txlineConnectionActive = true;
      connectingToTxline = false;
      stopSimulation();
      console.log('[SSE Multiplexer] Connected to real TxLINE stream successfully!');

      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const dataContent = line.slice(5).trim();
            if (dataContent) {
              try {
                const parsed = JSON.parse(dataContent);
                const normalized = extractMatchDetails(parsed);
                // Keep signature or ServerId if present
                (normalized as any).signature = parsed.signature || (parsed.Update && parsed.Update.ServerId) || 'txline_verified_signature';

                const encoder = new TextEncoder();
                const payload = encoder.encode(`data: ${JSON.stringify(normalized)}\n\n`);
                clients.forEach(c => {
                  try { c.enqueue(payload); } catch { clients.delete(c); }
                });
              } catch {
                // Forward raw line if not JSON
                const encoder = new TextEncoder();
                const payload = encoder.encode(`${line}\n\n`);
                clients.forEach(c => {
                  try { c.enqueue(payload); } catch { clients.delete(c); }
                });
              }
            }
          }
        }
      });

      res.on('end', () => {
        console.log('[SSE Multiplexer] Real TxLINE stream ended. Falling back.');
        txlineConnectionActive = false;
        if (useMock) startSimulation();
        setTimeout(tryConnectTxline, 5000);
      });
    });

    req.on('error', (err) => {
      console.error('[SSE Multiplexer] Request error connecting to TxLINE:', err.message);
      connectingToTxline = false;
      txlineConnectionActive = false;
      if (useMock) startSimulation();
      setTimeout(tryConnectTxline, 10000);
    });

    req.end();
  } catch (err: any) {
    console.error('[SSE Multiplexer] Exception during connection setup:', err.message);
    connectingToTxline = false;
    txlineConnectionActive = false;
    if (useMock) startSimulation();
    setTimeout(tryConnectTxline, 10000);
  }
}

function extractMatchDetails(item: any) {
  const info = item.FixtureInfo || {};
  const matchId = (info.FixtureId || item.matchId || item.id || item.match_id || '').toString() || `TX-${Math.random().toString(36).substr(2, 9)}`;
  
  let homeTeam = '';
  let awayTeam = '';
  if (info.Participant1 !== undefined) {
    const p1IsHome = info.Participant1IsHome ?? true;
    homeTeam = p1IsHome ? info.Participant1 : info.Participant2;
    awayTeam = p1IsHome ? info.Participant2 : info.Participant1;
  } else {
    homeTeam = typeof item.homeTeam === 'object' ? (item.homeTeam.name || item.homeTeam.title) : (item.homeTeam || item.home_team || item.home || '');
    awayTeam = typeof item.awayTeam === 'object' ? (item.awayTeam.name || item.awayTeam.title) : (item.awayTeam || item.away_team || item.away || '');
  }

  let homeScore = 0;
  let awayScore = 0;
  if (item.Update && item.Update.Scores) {
    homeScore = item.Update.Scores.Participant1 ?? 0;
    awayScore = item.Update.Scores.Participant2 ?? 0;
  } else {
    homeScore = item.homeScore !== undefined ? item.homeScore : (item.home_score !== undefined ? item.home_score : 0);
    awayScore = item.awayScore !== undefined ? item.awayScore : (item.away_score !== undefined ? item.away_score : 0);
  }

  const totalStats = item.totalStats !== undefined ? item.totalStats : (item.total_stats !== undefined ? item.total_stats : (homeScore + awayScore));

  const rawKickoff = info.StartTime || item.kickoffTime || item.kickoff_time || item.kickoff || item.date || Date.now();
  const kickoffTime = typeof rawKickoff === 'string'
    ? new Date(rawKickoff).getTime()
    : (rawKickoff < 10000000000 ? rawKickoff * 1000 : rawKickoff);

  const status = (info.GameState || item.status || item.state || 'SCHEDULED').toUpperCase();
  
  const comp = info.Competition || '';
  const sportRaw = info.Sport || item.sport || item.sport_type || 'Football';
  
  let sport = 'Football';
  if (comp.toLowerCase().includes('world cup') || matchId.endsWith('WC26') || matchId.toLowerCase().includes('wc')) {
    sport = 'World Cup 🏆';
  } else if (comp) {
    sport = comp; // e.g. Champions League
  } else if (sportRaw.toLowerCase() === 'basketball' || sportRaw.toLowerCase() === 'nba') {
    sport = 'Basketball';
  } else {
    sport = sportRaw;
  }

  return {
    id: matchId,
    homeTeam: addFlagEmojiIfMissing(homeTeam),
    awayTeam: addFlagEmojiIfMissing(awayTeam),
    status,
    homeScore,
    awayScore,
    totalStats,
    kickoffTime,
    sport
  };
}

function addFlagEmojiIfMissing(teamName: string): string {
  if (!teamName) return '';
  if (teamName.includes('🇦🇷') || teamName.includes('🇫🇷') || teamName.includes('🇧🇷') || teamName.includes('🇩🇪') || teamName.includes('🇺🇸') || teamName.includes('🇲🇽') || teamName.includes('🏴󠁧󠁢󠁥󠁮󠁧󠁿') || teamName.includes('🇮🇹') || teamName.includes('🇪🇸') || teamName.includes('🇵🇹')) {
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
  return teamName;
}

async function fetchTxlineFixtures(apiToken: string): Promise<any[]> {
  const txlineOrigin = process.env.TXLINE_API_ORIGIN || 'https://txline-dev.txodds.com';
  try {
    console.log(`[SSE Multiplexer] Fetching guest JWT from ${txlineOrigin}...`);
    const authRes = await fetch(`${txlineOrigin}/auth/guest/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!authRes.ok) {
      throw new Error(`Guest auth failed with status ${authRes.status}`);
    }
    const authData = await authRes.json();
    const jwt = authData.token || authData.jwt;
    if (!jwt) {
      throw new Error('No JWT found in auth response');
    }

    console.log(`[SSE Multiplexer] Fetching fixtures from ${txlineOrigin}/api/fixtures...`);
    const fixturesRes = await fetch(`${txlineOrigin}/api/fixtures`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'X-Api-Token': apiToken
      }
    });

    if (!fixturesRes.ok) {
      throw new Error(`Fixtures fetch failed with status ${fixturesRes.status}`);
    }

    const data = await fixturesRes.json();
    const fixtures = Array.isArray(data) ? data : (data.fixtures || data.data || []);
    
    console.log(`[SSE Multiplexer] Successfully fetched ${fixtures.length} fixtures from TxLINE API.`);
    
    return fixtures.map((f: any) => {
      return extractMatchDetails(f);
    });
  } catch (err: any) {
    console.error('[SSE Multiplexer] Error calling TxLINE REST API:', err.message);
    return [];
  }
}

export async function GET(req: NextRequest) {
  tryConnectTxline();
  
  const useMock = process.env.USE_MOCK_SIMULATION !== 'false';
  if (useMock) {
    startSimulation();
  }

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
      
      let matchesToStream = matchesSimulated;
      if (apiToken) {
        const dynamicFixtures = await fetchTxlineFixtures(apiToken);
        if (dynamicFixtures.length > 0) {
          matchesToStream = dynamicFixtures;
        }
      }

      matchesToStream.forEach(m => {
        const payload = JSON.stringify({
          matchId: m.id,
          status: m.status,
          homeScore: m.homeScore,
          awayScore: m.awayScore,
          totalStats: m.totalStats,
          timestamp: Date.now(),
          signature: 'mock_initial_data',
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          kickoffTime: m.kickoffTime,
          sport: m.sport
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
