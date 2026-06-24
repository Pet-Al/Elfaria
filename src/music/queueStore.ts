import type { QueueStoreManager, StoredQueue } from 'lavalink-client';
import { deleteAppSetting, getAppSetting, setAppSetting } from '../db/appSettings.js';

/**
 * DB-backed queue persistence (session-migration primitive).
 *
 * lavalink-client keeps each guild's queue in memory by default, so a bot
 * restart loses it. This stores the serialized queue (current + upcoming +
 * previous) in the shared DB keyed per guild, so after a restart — paired with
 * the 24/7 auto-rejoin — the FULL queue is restored, not just the connection.
 * The shared DB also means any pod that ends up owning the guild can load it.
 *
 * Lavalink can't migrate a mid-stream audio session between nodes, so a track
 * restarts from the beginning rather than resuming at the exact position — but
 * the queue itself survives, which is the part users actually notice.
 */
const key = (guildId: string) => `queue:${guildId}`;

export const dbQueueStore: QueueStoreManager = {
  async get(guildId: string): Promise<string | undefined> {
    return (await getAppSetting(key(guildId)).catch(() => undefined)) ?? undefined;
  },
  async set(guildId: string, value: StoredQueue | string): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    await setAppSetting(key(guildId), serialized).catch(() => undefined);
  },
  async delete(guildId: string): Promise<void> {
    await deleteAppSetting(key(guildId)).catch(() => undefined);
  },
  // We store a JSON string, so stringify/parse just bridge string <-> object.
  stringify(value: StoredQueue | string): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
  },
  parse(value: StoredQueue | string): Partial<StoredQueue> {
    try {
      return typeof value === 'string' ? (JSON.parse(value) as Partial<StoredQueue>) : value;
    } catch {
      return {};
    }
  },
};
