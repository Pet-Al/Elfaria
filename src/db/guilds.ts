import { config } from '../config.js';
import { cache } from '../cache/index.js';
import { db } from './index.js';

/**
 * Per-guild settings repository (doc §6).
 *
 * Reads go through the in-memory cache (doc §7) so hot paths — e.g. resolving
 * the default volume on every /play — don't hit SQLite each time. Writes update
 * the row and invalidate the cache entry.
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

const selectStmt = db.prepare<[string], GuildSettingsRow>(
  'SELECT guild_id, default_volume, dj_role_id FROM guild_settings WHERE guild_id = ?',
);

const upsertStmt = db.prepare(`
  INSERT INTO guild_settings (guild_id, default_volume, dj_role_id, updated_at)
  VALUES (@guildId, @defaultVolume, @djRoleId, unixepoch())
  ON CONFLICT (guild_id) DO UPDATE SET
    default_volume = excluded.default_volume,
    dj_role_id     = excluded.dj_role_id,
    updated_at     = unixepoch()
`);

function rowToSettings(row: GuildSettingsRow): GuildSettings {
  return {
    guildId: row.guild_id,
    defaultVolume: row.default_volume,
    djRoleId: row.dj_role_id,
  };
}

function defaults(guildId: string): GuildSettings {
  return {
    guildId,
    defaultVolume: config.music.defaultVolume,
    djRoleId: null,
  };
}

/** Returns stored settings, or sensible defaults if the guild has none yet. */
export function getGuildSettings(guildId: string): GuildSettings {
  const cached = cache.get<GuildSettings>(cacheKey(guildId));
  if (cached) return cached;

  const row = selectStmt.get(guildId);
  const settings = row ? rowToSettings(row) : defaults(guildId);
  cache.set(cacheKey(guildId), settings);
  return settings;
}

/** Patch one or more settings fields, persisting and refreshing the cache. */
export function updateGuildSettings(
  guildId: string,
  patch: Partial<Omit<GuildSettings, 'guildId'>>,
): GuildSettings {
  const current = getGuildSettings(guildId);
  const next: GuildSettings = { ...current, ...patch };
  upsertStmt.run(next);
  cache.set(cacheKey(guildId), next);
  return next;
}
