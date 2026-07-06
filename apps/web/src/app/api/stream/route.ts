import { NextRequest } from 'next/server';
import * as http from 'http';
import * as https from 'https';

const clients = new Set<ReadableStreamDefaultController>();
let txlineConnectionActive = false;

// Mock matches fallback data for simulation
let matchesSimulated = [
  { id: 'LIV-MCI-2026', homeTeam: 'Liverpool', awayTeam: 'Man City', status: 'LIVE', homeScore: 1, awayScore: 1, totalStats: 2, kickoffTime: Date.now() - 1800000, sport: 'Football' },
  { id: 'CHE-ARS-2026', homeTeam: 'Chelsea', awayTeam: 'Arsenal', status: 'SCHEDULED', homeScore: 0, awayScore: 0, totalStats: 0, kickoffTime: Date.now() + 600000, sport: 'Football' },
  { id: 'LAL-BOS-2026', homeTeam: 'LA Lakers', awayTeam: 'Boston Celtics', status: 'LIVE', homeScore: 92, awayScore: 95, totalStats: 187, kickoffTime: Date.now() - 3600000, sport: 'Basketball' }
];

let simStarted = false;

function startSimulation() {
  if (simStarted || txlineConnectionActive) return;
  simStarted = true;
  console.log('[SSE Multiplexer] Starting fallback match event simulation...');

  setInterval(() => {
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

  const txlineUrl = process.env.TXLINE_URL || 'http://localhost:4000/stream';
  console.log(`[SSE Multiplexer] Trying to connect to real TxLINE stream at: ${txlineUrl}`);

  const client = txlineUrl.startsWith('https') ? https : http;

  const req = client.get(txlineUrl, (res) => {
    if (res.statusCode !== 200) {
      connectingToTxline = false;
      return;
    }
    txlineConnectionActive = true;
    connectingToTxline = false;
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
            const encoder = new TextEncoder();
            const payload = encoder.encode(`data: ${dataContent}\n\n`);
            clients.forEach(c => {
              try { c.enqueue(payload); } catch { clients.delete(c); }
            });
          }
        }
      }
    });

    res.on('end', () => {
      console.log('[SSE Multiplexer] Real TxLINE stream ended. Falling back.');
      txlineConnectionActive = false;
      startSimulation();
      setTimeout(tryConnectTxline, 5000);
    });
  });

  req.on('error', () => {
    connectingToTxline = false;
    txlineConnectionActive = false;
    startSimulation();
    setTimeout(tryConnectTxline, 10000);
  });
}

export async function GET(req: NextRequest) {
  tryConnectTxline();
  startSimulation();

  const stream = new ReadableStream({
    start(controller) {
      clients.add(controller);

      const encoder = new TextEncoder();
      matchesSimulated.forEach(m => {
        const payload = JSON.stringify({
          matchId: m.id,
          status: m.status,
          homeScore: m.homeScore,
          awayScore: m.awayScore,
          totalStats: m.totalStats,
          timestamp: Date.now(),
          signature: 'mock_initial_data'
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
