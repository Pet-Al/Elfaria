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

/** Self-contained dashboard page; fetches the JSON endpoints and auto-refreshes. */
const DASHBOARD_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Elfaria — dashboard</title><style>
:root{color-scheme:dark}body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#0b0d12;color:#e6e8ee}
.wrap{max-width:760px;margin:0 auto;padding:32px 20px}h1{font-size:1.4rem;margin:0 0 4px}
.muted{color:#8b90a0;font-size:.85rem}.cards{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}
.card{flex:1 1 130px;background:#141821;border:1px solid #232838;border-radius:12px;padding:16px}
.card b{display:block;font-size:1.8rem}ol{padding-left:1.4em}li{margin:.2em 0}a{color:#8aa0ff}
h2{font-size:1rem;margin:24px 0 8px;color:#aeb4c6}</style></head><body><div class="wrap">
<h1>🎶 Elfaria</h1><div class="muted">Live, aggregate stats · auto-refreshes every 10s</div>
<div class="cards">
<div class="card"><span class="muted">Servers</span><b id="guilds">–</b></div>
<div class="card"><span class="muted">Active players</span><b id="players">–</b></div>
<div class="card"><span class="muted">Lavalink nodes</span><b id="nodes">–</b></div>
<div class="card"><span class="muted">Uptime</span><b id="uptime">–</b></div></div>
<h2>Top tracks</h2><ol id="top"><li class="muted">loading…</li></ol>
<div class="muted" id="err"></div></div><script>
function fmt(s){const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);
return [d&&d+"d",h&&h+"h",m+"m"].filter(Boolean).join(" ")}
async function tick(){try{
const s=await (await fetch("/api/stats")).json();
guilds.textContent=s.guilds;players.textContent=s.activePlayers;nodes.textContent=s.connectedNodes;
uptime.textContent=fmt(s.uptimeSeconds);
const t=(await (await fetch("/api/top-tracks")).json()).tracks||[];
top.innerHTML=t.length?t.map(x=>'<li><a href="'+x.uri+'" target="_blank" rel="noopener">'+
(x.title||x.uri)+'</a> <span class="muted">'+(x.author||"")+' · '+x.plays+' plays</span></li>').join("")
:'<li class="muted">no plays yet</li>';err.textContent="";
}catch(e){err.textContent="failed to load stats"}}
tick();setInterval(tick,10000);</script></body></html>`;

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
  const url = req.url ?? '/';

  if (req.method !== 'GET') {
    res.setHeader('content-type', 'application/json');
    res.writeHead(405).end(JSON.stringify({ error: 'method not allowed' }));
    return;
  }

  // Read-only web dashboard (HTML) over the aggregate API. No PII.
  if (url === '/' || url === '/dashboard') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(DASHBOARD_HTML);
    return;
  }

  res.setHeader('content-type', 'application/json');
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
    logger.info({ port: config.api.port }, 'public API + dashboard listening (/ , /api/health, /api/stats, /api/top-tracks)');
  });
}
