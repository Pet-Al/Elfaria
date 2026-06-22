import { createServer } from 'node:http';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { ElfariaClient } from '../client.js';
import { config } from '../config.js';
import { logger } from './logger.js';

/**
 * Prometheus metrics (doc §10 observability; roadmap "metrics + tracing").
 *
 * Exposes a /metrics endpoint in the Prometheus text format on its own port so
 * a scraper (and, via the Prometheus Adapter, the Kubernetes HPA) can read:
 *   - RED metrics for slash commands (Rate, Errors, Duration),
 *   - process metrics (CPU, memory, event-loop lag) from prom-client defaults,
 *   - gauges for live Lavalink players and connected nodes — the
 *     player-count signal the audio HPA wants (k8s/lavalink-hpa.yaml).
 *
 * Metrics are best-effort and isolated: the endpoint runs on a separate HTTP
 * server and never touches the gateway or audio paths.
 */

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'elfaria_' });

/** Rate + Errors: every handled command, labelled by name and outcome. */
export const commandsTotal = new Counter({
  name: 'elfaria_commands_total',
  help: 'Slash commands handled, by command and status (ok|error).',
  labelNames: ['command', 'status'] as const,
  registers: [registry],
});

/** Duration: command handler latency. */
export const commandDuration = new Histogram({
  name: 'elfaria_command_duration_seconds',
  help: 'Slash command handler duration in seconds, by command.',
  labelNames: ['command'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

/** Live player count — set on scrape from the Lavalink manager. */
const activePlayers = new Gauge({
  name: 'elfaria_active_players',
  help: 'Lavalink players currently playing.',
  registers: [registry],
});

/** Connected Lavalink nodes — set on scrape. */
const connectedNodes = new Gauge({
  name: 'elfaria_lavalink_nodes_connected',
  help: 'Lavalink nodes currently connected.',
  registers: [registry],
});

/**
 * Time a command handler and record its outcome. Wrap the call so a thrown
 * error is still counted before being re-thrown to the existing error handler.
 */
export async function instrumentCommand<T>(
  command: string,
  run: () => T | Promise<T>,
): Promise<T> {
  const end = commandDuration.startTimer({ command });
  try {
    const result = await run();
    commandsTotal.inc({ command, status: 'ok' });
    return result;
  } catch (err) {
    commandsTotal.inc({ command, status: 'error' });
    throw err;
  } finally {
    end();
  }
}

/** Refresh scrape-time gauges from the Lavalink manager. */
function sampleGauges(client: ElfariaClient): void {
  let playing = 0;
  for (const player of client.lavalink.players.values()) if (player.playing) playing += 1;
  activePlayers.set(playing);

  let connected = 0;
  for (const node of client.lavalink.nodeManager.nodes.values()) if (node.connected) connected += 1;
  connectedNodes.set(connected);
}

/**
 * Start the metrics HTTP server (no-op when METRICS_ENABLED=false). Serves
 * Prometheus text on GET /metrics; everything else is 404.
 */
export function startMetricsServer(client: ElfariaClient): void {
  if (!config.metrics.enabled) {
    logger.info('metrics disabled (METRICS_ENABLED=false)');
    return;
  }

  // When sharded, every shard runs in the same container/process group, so each
  // needs a distinct port (base + shard id) to avoid binding the same one twice.
  // Single-process runs have no shard id and use the base port unchanged.
  const shardId = client.shard?.ids[0] ?? 0;
  const port = config.metrics.port + shardId;

  const server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    sampleGauges(client);
    registry
      .metrics()
      .then((body) => {
        res.writeHead(200, { 'Content-Type': registry.contentType }).end(body);
      })
      .catch((err) => {
        logger.warn({ err }, 'failed to render metrics');
        res.writeHead(500).end();
      });
  });

  server.on('error', (err) => logger.warn({ err }, 'metrics server error'));
  server.listen(port, () => {
    logger.info({ port, shard: shardId }, 'metrics server listening on /metrics');
  });
}
