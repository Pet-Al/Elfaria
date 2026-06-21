import { ActivityType, Events } from 'discord.js';
import type { ElfariaClient } from '../client.js';
import { logger } from '../lib/logger.js';
import type { BotEvent } from '../lib/types.js';

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

    logger.info(
      { user: client.user.tag, guilds: client.guilds.cache.size },
      'gateway ready — Elfaria is online',
    );
    client.user.setActivity('/play', { type: ActivityType.Listening });
  },
};
