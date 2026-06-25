import { ActivityType, type Client, Events, PresenceUpdateStatus } from 'discord.js';
import { pruneOldData } from '../analytics/events.js';
import type { ElfariaClient } from '../client.js';
import { config } from '../config.js';
import { startApiServer } from '../lib/api.js';
import { clusterGuildCount, publishLocalCount, shardKey } from '../lib/clusterCount.js';
import { clearGuildCommands, reconcileGlobalCommands } from '../lib/commandSync.js';
import { logger } from '../lib/logger.js';
import { startMetricsServer } from '../lib/metrics.js';
import { startPlayCanary } from '../lib/playCanary.js';
import { startPlaybackProbe } from '../lib/playbackProbe.js';
import type { BotEvent } from '../lib/types.js';
import { loadRecommender, startRecommenderReload } from '../ml/recommender.js';
import { expireStalePanels } from '../music/panelStore.js';
import { autoRejoin247 } from '../music/rejoin.js';

const RETENTION_SWEEP_MS = 24 * 60 * 60 * 1000;

/**
 * Register slash commands GLOBALLY on boot so a fresh build/restart never needs
 * a separate deploy step. Idempotent and fail-soft (a transient Discord hiccup
 * logs and continues — it must never block the bot coming online). Under
 * sharding only shard 0 runs it, so the global PUT happens once, not per shard.
 */
/** Does this process own shard 0? (so cluster-wide one-shot work runs once). */
function ownsShardZero(client: Client<true>): boolean {
  if (client.shard) return client.shard.ids.includes(0); // ShardingManager path
  if (config.sharding.multiPod) return config.sharding.multiPod.shardIds.includes(0);
  return true; // single process
}

async function autoDeployCommands(client: Client<true>): Promise<void> {
  // Nuclear de-dupe: clear guild-scoped commands from every server this process
  // owns (runs per pod for its own guilds, regardless of shard 0).
  if (config.commands.clearGuildCommands) {
    try {
      const cleared = await clearGuildCommands([...client.guilds.cache.keys()]);
      logger.info({ cleared }, 'cleared guild-scoped commands (CLEAR_ALL_GUILD_COMMANDS)');
    } catch (err) {
      logger.warn({ err }, 'clear-all-guild-commands failed');
    }
  }

  if (!config.commands.autoDeploy) return;
  if (!ownsShardZero(client)) return;
  try {
    const result = await reconcileGlobalCommands();
    if (result.unchanged) {
      logger.info('slash commands already up to date (GLOBAL) — no re-deploy needed');
    } else {
      logger.info(result, 'reconciled slash commands on boot (GLOBAL; cleared any guild dupes)');
    }
  } catch (err) {
    logger.error({ err }, 'auto command registration failed — continuing (try `npm run deploy`)');
  }
}

// A real twitch.tv/youtube URL is required for Discord to render the purple
// "Streaming" status; the channel itself doesn't have to be live.
const STREAM_URL = 'https://www.twitch.tv/discord';
const PRESENCE_REFRESH_MS = 10 * 60 * 1000;

/**
 * Total guild count. `client.guilds.cache.size` is the number of servers the bot
 * is in (NOT "mutual with you", NOT permission-filtered). Under sharding each
 * process only holds its own shard's guilds, so we sum across shards for an
 * accurate total; if a sibling shard isn't ready yet we fall back to local size.
 */
async function guildCount(client: Client<true>): Promise<number> {
  const local = client.guilds.cache.size;

  // Single-pod ShardingManager: sum across this manager's shards via IPC.
  if (client.shard) {
    try {
      const counts = (await client.shard.fetchClientValues('guilds.cache.size')) as number[];
      return counts.reduce((sum, n) => sum + (n ?? 0), 0);
    } catch {
      return local; // a sibling shard may still be spawning — use local
    }
  }

  // Multi-pod (or single process): publish this process's count and read the
  // cluster-wide sum from Redis. With no Redis this is just `local` (unchanged).
  await publishLocalCount(shardKey(), local);
  return clusterGuildCount(local);
}

/** Set the Streaming presence to "music in N servers". Never throws. */
async function updatePresence(client: Client<true>): Promise<void> {
  try {
    const count = await guildCount(client);
    client.user.setPresence({
      status: PresenceUpdateStatus.Online,
      activities: [
        {
          name: `music in ${count} server${count === 1 ? '' : 's'}!`,
          type: ActivityType.Streaming,
          url: STREAM_URL,
        },
      ],
    });
  } catch (err) {
    logger.warn({ err }, 'failed to update presence');
  }
}

/**
 * Fired once the gateway handshake completes (doc §1, milestone 1). Now that the
 * bot's user id is known, initialise the Lavalink manager (it needs the id to
 * authenticate the node connection).
 */
export const ready: BotEvent<Events.ClientReady> = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    const elfaria = client as ElfariaClient;
    await elfaria.lavalink.init({ id: client.user.id, username: client.user.username });
    await autoDeployCommands(client);
    startMetricsServer(elfaria);
    // The public API binds a single fixed port (API_PORT). Under sharding every
    // shard is its own process on the same host, so only shard 0 may bind it —
    // otherwise the siblings crash-loop with EADDRINUSE. (Metrics is per-shard:
    // it offsets its port by shard id, so it doesn't need this guard.)
    if (ownsShardZero(client)) startApiServer(elfaria);
    startPlaybackProbe(elfaria); // black-box source-resolve health (feeds the SLO)
    startPlayCanary(elfaria); // end-to-end PLAY canary (opt-in, staging VC)

    // Load the trained recommender if an artifact exists (fail-soft → heuristics),
    // and reload periodically so a nightly retrain is picked up without a restart.
    void loadRecommender();
    startRecommenderReload();

    // Retire any now-playing panels left "live" by a previous (crashed) process.
    void expireStalePanels(client);

    // Rejoin voice for guilds that had 24/7 on (and resume their lofi stream).
    void autoRejoin247(elfaria);

    // GDPR retention: prune old history/events on boot and daily thereafter.
    void pruneOldData(config.retentionDays);
    setInterval(() => void pruneOldData(config.retentionDays), RETENTION_SWEEP_MS);

    logger.info(
      { user: client.user.tag, guilds: client.guilds.cache.size },
      'gateway ready — Elfaria is online',
    );

    void updatePresence(client);
    // Keep the server count current: refresh on every join/leave, plus a slow
    // periodic refresh as a backstop.
    client.on(Events.GuildCreate, () => void updatePresence(client));
    client.on(Events.GuildDelete, () => void updatePresence(client));
    setInterval(() => void updatePresence(client), PRESENCE_REFRESH_MS);
  },
};
