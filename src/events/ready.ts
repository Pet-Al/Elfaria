import { ActivityType, type Client, Events, PresenceUpdateStatus } from 'discord.js';
import { pruneOldData } from '../analytics/events.js';
import type { ElfariaClient } from '../client.js';
import { config } from '../config.js';
import { startApiServer } from '../lib/api.js';
import { syncCommands } from '../lib/commandSync.js';
import { logger } from '../lib/logger.js';
import { startMetricsServer } from '../lib/metrics.js';
import type { BotEvent } from '../lib/types.js';
import { loadRecommender } from '../ml/recommender.js';

const RETENTION_SWEEP_MS = 24 * 60 * 60 * 1000;

/**
 * Register slash commands GLOBALLY on boot so a fresh build/restart never needs
 * a separate deploy step. Idempotent and fail-soft (a transient Discord hiccup
 * logs and continues — it must never block the bot coming online). Under
 * sharding only shard 0 runs it, so the global PUT happens once, not per shard.
 */
async function autoDeployCommands(client: Client<true>): Promise<void> {
  if (!config.commands.autoDeploy) return;
  if (client.shard && !client.shard.ids.includes(0)) return;
  try {
    const result = await syncCommands('global');
    logger.info(result, 'auto-registered slash commands on boot (GLOBAL)');
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
  if (client.shard) {
    try {
      const counts = (await client.shard.fetchClientValues('guilds.cache.size')) as number[];
      return counts.reduce((sum, n) => sum + (n ?? 0), 0);
    } catch {
      // a sibling shard may still be spawning — fall back to this shard's count
    }
  }
  return client.guilds.cache.size;
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
    startApiServer(elfaria);

    // Load the trained recommender if an artifact exists (fail-soft → heuristics).
    void loadRecommender();

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
