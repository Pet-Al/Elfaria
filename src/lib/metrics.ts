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

/** Search cache lookups, by result (hit|miss). */
export const searchCacheEvents = new Counter({
  name: 'elfaria_search_cache_total',
  help: 'Search cache lookups, by result.',
  labelNames: ['result'] as const,
  registers: [registry],
});

/** Lavalink search/resolve latency. */
export const sourceResolveDuration = new Histogram({
  name: 'elfaria_source_resolve_seconds',
  help: 'Lavalink search/resolve latency in seconds.',
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});

/** Component (button/select) interactions handled, by kind and outcome. */
export const componentInteractionsTotal = new Counter({
  name: 'elfaria_component_interactions_total',
  help: 'Now-playing / history / queue component interactions, by kind and status.',
  labelNames: ['kind', 'status'] as const,
  registers: [registry],
});

/** Black-box playback probe: 1 if the last source-resolve probe succeeded, else 0. */
export const playbackProbeSuccess = new Gauge({
  name: 'elfaria_playback_probe_success',
  help: 'Whether the most recent end-to-end source-resolve probe succeeded (1/0).',
  registers: [registry],
});

/** Latency (seconds) of the last successful playback probe. */
export const playbackProbeLatency = new Gauge({
  name: 'elfaria_playback_probe_latency_seconds',
  help: 'Latency of the most recent successful playback probe, in seconds.',
  registers: [registry],
});

/** End-to-end PLAY canary: 1 if the bot actually played audio (position advanced). */
export const playCanarySuccess = new Gauge({
  name: 'elfaria_play_canary_success',
  help: 'Whether the most recent end-to-end PLAY canary streamed audio (1/0).',
  registers: [registry],
});

/** Loaded recommender model: number of track vectors (0 = no model / cold start). */
export const recommenderTracks = new Gauge({
  name: 'elfaria_recommender_tracks',
  help: 'Number of track embeddings in the currently-loaded recommender model.',
  registers: [registry],
});

/** Unix seconds the loaded recommender model was trained at (0 if none). */
export const recommenderTrainedAt = new Gauge({
  name: 'elfaria_recommender_trained_timestamp_seconds',
  help: 'When the currently-loaded recommender model was trained (unix seconds).',
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

/**
 * Time a component (button/select) handler and record its outcome — the same
 * RED treatment commands get, so EVERY client interaction is observed, not just
 * slash commands. `kind` is the custom-id prefix (np|hist|q|…).
 */
export async function instrumentComponent<T>(kind: string, run: () => T | Promise<T>): Promise<T> {
  try {
    const result = await run();
    componentInteractionsTotal.inc({ kind, status: 'ok' });
    return result;
  } catch (err) {
    componentInteractionsTotal.inc({ kind, status: 'error' });
    throw err;
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
