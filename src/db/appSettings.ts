import { db } from './driver.js';

/** Well-known app_settings keys (owner toggles + internal bookkeeping). */
export const SettingKeys = {
  /** "false" disables the daily 90-day retention prune. */
  retentionEnabled: 'retention_enabled',
  /** "false" disables user access to the /forget-me command. */
  forgetMeEnabled: 'forgetme_enabled',
} as const;

/**
 * App-wide key/value settings (not per-guild). Backs:
 *   - the idempotent command-deploy hash (so we don't re-PUT global commands —
 *     and re-trigger Discord's ~1h propagation — when nothing changed), and
 *   - the owner-only runtime toggles (retention deletion, /forget-me access).
 *
 * Stored in the shared DB so the value is consistent across shards/pods (only
 * the shard-0 pod writes the deploy hash; every pod reads the toggles).
 */

export async function getAppSetting(key: string): Promise<string | undefined> {
  const row = await db.get<{ value: string | null }>(
    'SELECT value FROM app_settings WHERE key = ?',
    [key],
  );
  return row?.value ?? undefined;
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.run(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, now],
  );
}

/** A boolean setting that defaults to `true` unless explicitly set to "false". */
export async function getBoolSetting(key: string, fallback = true): Promise<boolean> {
  const value = await getAppSetting(key);
  if (value === undefined) return fallback;
  return value !== 'false';
}
