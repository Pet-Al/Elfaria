import type { Client, ClientEvents } from 'discord.js';
import type { BotEvent } from '../lib/types.js';
import { interactionCreate } from './interactionCreate.js';
import { ready } from './ready.js';
import { voiceStateUpdate } from './voiceStateUpdate.js';

/** Bind a single typed event to the client. */
function bindEvent<K extends keyof ClientEvents>(client: Client, event: BotEvent<K>): void {
  const handler = (...args: ClientEvents[K]) => {
    void event.execute(...args);
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
