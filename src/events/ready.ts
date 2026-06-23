import { ActivityType, type Client, Events, PresenceUpdateStatus } from 'discord.js';
import type { ElfariaClient } from '../client.js';
import { logger } from '../lib/logger.js';
import { startMetricsServer } from '../lib/metrics.js';
import type { BotEvent } from '../lib/types.js';

// A real twitch.tv/youtube URL is required for Discord to render the purple
// "Streaming" status; the channel itself doesn't have to be live.
const STREAM_URL = 'https://www.twitch.tv/discord';
const PRESENCE_REFRESH_MS = 10 * 60 * 1000;

/**
 * Set the bot's presence to a Streaming status showing how many servers it's in.
 * Refreshed periodically so the count tracks joins/leaves. NOTE: under sharding
 * this counts the current shard's guilds; an exact total would aggregate across
 * shards via the sharding manager.
 */
function updatePresence(client: Client<true>): void {
  const count = client.guilds.cache.size;
  client.user.setPresence({
    status: PresenceUpdateStatus.Online,
    activities: [
      {
        name: `🎵 music in ${count} server${count === 1 ? '' : 's'}`,
        type: ActivityType.Streaming,
        url: STREAM_URL,
      },
    ],
  });
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
    startMetricsServer(elfaria);

    logger.info(
      { user: client.user.tag, guilds: client.guilds.cache.size },
      'gateway ready — Elfaria is online',
    );

    updatePresence(client);
    setInterval(() => updatePresence(client), PRESENCE_REFRESH_MS);
  },
};
