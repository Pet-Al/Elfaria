import type { Client, ClientEvents } from 'discord.js';
import { logger } from '../lib/logger.js';
import type { BotEvent } from '../lib/types.js';
import { interactionCreate } from './interactionCreate.js';
import { ready } from './ready.js';
import { voiceStateUpdate } from './voiceStateUpdate.js';

/**
 * Bind a single typed event to the client. Self-healing: any error a handler
 * throws — synchronously or from its returned promise — is caught and logged, so
 * one bad event (a malformed payload, a transient API error) can never crash the
 * gateway loop.
 */
function bindEvent<K extends keyof ClientEvents>(client: Client, event: BotEvent<K>): void {
  const handler = (...args: ClientEvents[K]) => {
    try {
      const result = event.execute(...args);
      if (result instanceof Promise) {
        result.catch((err) => logger.error({ err, event: event.name }, 'event handler rejected'));
      }
    } catch (err) {
      logger.error({ err, event: event.name }, 'event handler threw');
    }
  };
  if (event.once) client.once(event.name, handler);
  else client.on(event.name, handler);
}

/** Wire every gateway event handler (doc §1). */
export function registerEvents(client: Client): void {
  bindEvent(client, ready);
  bindEvent(client, interactionCreate);
  bindEvent(client, voiceStateUpdate);
}
