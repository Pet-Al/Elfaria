import { ActivityType, Events } from 'discord.js';
import { logger } from '../lib/logger.js';
import type { BotEvent } from '../lib/types.js';

/**
 * Fired once the gateway handshake completes (doc §1, milestone 1).
 */
export const ready: BotEvent<Events.ClientReady> = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    logger.info(
      { user: client.user.tag, guilds: client.guilds.cache.size },
      'gateway ready — Elfaria is online',
    );
    client.user.setActivity('/play', { type: ActivityType.Listening });
  },
};
