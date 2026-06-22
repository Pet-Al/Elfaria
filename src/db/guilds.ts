import { cache } from '../cache/index.js';
import { config } from '../config.js';
import { db } from './driver.js';

/**
 * Per-guild settings repository (doc §6).
 *
 * Reads go through the in-memory cache (doc §7) so hot paths — e.g. resolving
 * the default volume or DJ role — don't hit the DB each time. This cache is
 * intentionally per-process: the database is the shared source of truth, so an
 * extra in-memory layer stays correct even when sharded. Writes upsert the row
 * and refresh the cache entry.
 */

export interface GuildSettings {
  guildId: string;
  defaultVolume: number;
  djRoleId: string | null;
}

interface GuildSettingsRow {
  guild_id: string;
  default_volume: number;
  dj_role_id: string | null;
}

const cacheKey = (guildId: string) => `guild:${guildId}`;

function rowToSettings(row: GuildSettingsRow): GuildSettings {
  return {
    guildId: row.guild_id,
    defaultVolume: row.default_volume,
    djRoleId: row.dj_role_id,
  };
}

function defaults(guildId: string): GuildSettings {
  return { guildId, defaultVolume: config.music.defaultVolume, djRoleId: null };
}

/** Returns stored settings, or sensible defaults if the guild has none yet. */
export async function getGuildSettings(guildId: string): Promise<GuildSettings> {
  const cached = cache.get<GuildSettings>(cacheKey(guildId));
  if (cached) return cached;

  const row = await db.get<GuildSettingsRow>(
    'SELECT guild_id, default_volume, dj_role_id FROM guild_settings WHERE guild_id = ?',
    [guildId],
  );
  const settings = row ? rowToSettings(row) : defaults(guildId);
  cache.set(cacheKey(guildId), settings);
  return settings;
}

/** Patch one or more settings fields, persisting and refreshing the cache. */
export async function updateGuildSettings(
  guildId: string,
  patch: Partial<Omit<GuildSettings, 'guildId'>>,
): Promise<GuildSettings> {
  const current = await getGuildSettings(guildId);
  const next: GuildSettings = { ...current, ...patch };
  const now = Math.floor(Date.now() / 1000);

  await db.run(
    `INSERT INTO guild_settings (guild_id, default_volume, dj_role_id, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (guild_id) DO UPDATE SET
       default_volume = excluded.default_volume,
       dj_role_id     = excluded.dj_role_id,
       updated_at     = excluded.updated_at`,
    [next.guildId, next.defaultVolume, next.djRoleId, now],
  );

  cache.set(cacheKey(guildId), next);
  return next;
}
