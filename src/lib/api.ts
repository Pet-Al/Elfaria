import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import type { ElfariaClient } from '../client.js';
import { config } from '../config.js';
import { readDb } from '../db/driver.js';
import { logger } from './logger.js';

/**
 * Read-only public stats API (doc roadmap). Off by default (API_ENABLED=true to
 * turn on). Exposes ONLY aggregate, non-personal data — guild/player counts and
 * globally top tracks — so it's safe to expose publicly and is GDPR-clean (no
 * per-user or per-guild personal data). A separate HTTP server from /metrics.
 */

async function topTracks(limit = 10): Promise<unknown[]> {
  return readDb.all(
    `SELECT title, uri, author, COUNT(*) AS plays
     FROM events
     WHERE event_type = 'play' AND uri IS NOT NULL
     GROUP BY uri, title, author
     ORDER BY plays DESC
     LIMIT ?`,
    [limit],
  );
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  client: ElfariaClient,
): Promise<void> {
  res.setHeader('content-type', 'application/json');
  const url = req.url ?? '/';

  if (req.method !== 'GET') {
    res.writeHead(405).end(JSON.stringify({ error: 'method not allowed' }));
    return;
  }
  if (url === '/api/health') {
    res.end(JSON.stringify({ status: 'ok', uptimeSeconds: Math.floor(process.uptime()) }));
    return;
  }
  if (url === '/api/stats') {
    let activePlayers = 0;
    for (const p of client.lavalink.players.values()) if (p.playing) activePlayers += 1;
    let connectedNodes = 0;
    for (const n of client.lavalink.nodeManager.nodes.values()) if (n.connected) connectedNodes += 1;
    res.end(
      JSON.stringify({
        guilds: client.guilds.cache.size,
        activePlayers,
        connectedNodes,
        uptimeSeconds: Math.floor(process.uptime()),
      }),
    );
    return;
  }
  if (url.startsWith('/api/top-tracks')) {
    res.end(JSON.stringify({ tracks: await topTracks(10) }));
    return;
  }
  res.writeHead(404).end(JSON.stringify({ error: 'not found' }));
}

export function startApiServer(client: ElfariaClient): void {
  if (!config.api.enabled) return;
  const server = createServer((req, res) => {
    handle(req, res, client).catch((err) => {
      logger.warn({ err, url: req.url }, 'api request failed');
      if (!res.headersSent) res.writeHead(500);
      res.end(JSON.stringify({ error: 'internal' }));
    });
  });
  server.on('error', (err) => logger.warn({ err }, 'api server error'));
  server.listen(config.api.port, () => {
    logger.info({ port: config.api.port }, 'public stats API listening (/api/health, /api/stats, /api/top-tracks)');
  });
}
