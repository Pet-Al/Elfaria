import type { ElfariaClient } from '../client.js';
import { config } from '../config.js';
import { logger } from './logger.js';
import { playbackProbeLatency, playbackProbeSuccess } from './metrics.js';

/**
 * Black-box playback canary (doc roadmap / SLO). Periodically exercises the real
 * bot→Lavalink→YouTube resolve path with a known query and records whether it
 * worked + how long it took, as Prometheus gauges. This is a true end-to-end
 * health signal for the playback SLO — distinct from "is a node TCP-connected" —
 * so a node that's up but failing to resolve (e.g. a broken YouTube client) is
 * caught before users hit it. It only resolves, never plays, so it needs no
 * voice channel and consumes almost nothing.
 */
const PROBE_INTERVAL_MS = 5 * 60 * 1000;
const FIRST_PROBE_DELAY_MS = 30_000;
const PROBE_QUERY = 'ytsearch:lofi hip hop radio';

async function probeOnce(client: ElfariaClient): Promise<void> {
  const node = [...client.lavalink.nodeManager.nodes.values()].find((n) => n.connected);
  if (!node) {
    playbackProbeSuccess.set(0);
    return;
  }
  const start = Date.now();
  try {
    const result = await node.search({ query: PROBE_QUERY }, client.user ?? undefined);
    const ok = (result?.tracks?.length ?? 0) > 0;
    playbackProbeSuccess.set(ok ? 1 : 0);
    if (ok) playbackProbeLatency.set((Date.now() - start) / 1000);
    else logger.warn('playback probe resolved zero tracks — a source may be degraded');
  } catch (err) {
    playbackProbeSuccess.set(0);
    logger.warn({ err }, 'playback probe failed');
  }
}

/** Start the periodic probe (no-op when metrics are disabled — it feeds them). */
export function startPlaybackProbe(client: ElfariaClient): void {
  if (!config.metrics.enabled) return;
  setTimeout(() => void probeOnce(client), FIRST_PROBE_DELAY_MS).unref?.();
  setInterval(() => void probeOnce(client), PROBE_INTERVAL_MS).unref?.();
  logger.info('playback probe scheduled (black-box source-resolve health)');
}
