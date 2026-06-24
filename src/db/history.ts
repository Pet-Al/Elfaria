import { db } from './driver.js';

/**
 * Play-history repository (doc roadmap, "history / replay").
 *
 * A per-guild log of what's been played, written on every track start. Backs the
 * /history command and the /replay command + queue-finished Replay button (which
 * re-resolve the most recent track by URL — robust against stale encoded tracks).
 */

export interface HistoryEntry {
  title: string;
  uri: string;
  author: string | null;
}

/** Record a track as played in a guild. Fire-and-forget from the trackStart event. */
export async function recordPlay(
  guildId: string,
  track: { title: string; uri: string; author?: string | null },
  requesterId?: string,
): Promise<void> {
  await db.run(
    'INSERT INTO play_history (guild_id, title, uri, author, requester_id) VALUES (?, ?, ?, ?, ?)',
    [guildId, track.title, track.uri, track.author ?? null, requesterId ?? null],
  );
}

/** The most recent distinct tracks played in a guild, newest first. */
export async function getHistory(guildId: string, limit = 10): Promise<HistoryEntry[]> {
  const rows = await db.all<{ title: string; uri: string; author: string | null }>(
    `SELECT title, uri, author, MAX(played_at) AS last_played, MAX(id) AS last_id
     FROM play_history
     WHERE guild_id = ?
     GROUP BY uri, title, author
     ORDER BY last_played DESC, last_id DESC
     LIMIT ?`,
    [guildId, limit],
  );
  return rows.map((r) => ({ title: r.title, uri: r.uri, author: r.author }));
}

/** Count of DISTINCT tracks in a guild's history (for paging). */
export async function countHistory(guildId: string): Promise<number> {
  const row = await db.get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM (
       SELECT 1 FROM play_history WHERE guild_id = ? GROUP BY uri, title, author
     ) distinct_tracks`,
    [guildId],
  );
  return row?.c ?? 0;
}

/** One page of distinct history (newest first). 0-based page index. */
export async function getHistoryPage(
  guildId: string,
  page: number,
  perPage = 10,
): Promise<HistoryEntry[]> {
  const rows = await db.all<{ title: string; uri: string; author: string | null }>(
    `SELECT title, uri, author, MAX(played_at) AS last_played, MAX(id) AS last_id
     FROM play_history
     WHERE guild_id = ?
     GROUP BY uri, title, author
     ORDER BY last_played DESC, last_id DESC
     LIMIT ? OFFSET ?`,
    [guildId, perPage, Math.max(0, page) * perPage],
  );
  return rows.map((r) => ({ title: r.title, uri: r.uri, author: r.author }));
}

/** The single most recently played track in a guild (for /replay). */
export async function getLastPlayed(guildId: string): Promise<HistoryEntry | undefined> {
  const row = await db.get<{ title: string; uri: string; author: string | null }>(
    'SELECT title, uri, author FROM play_history WHERE guild_id = ? ORDER BY played_at DESC, id DESC LIMIT 1',
    [guildId],
  );
  return row ? { title: row.title, uri: row.uri, author: row.author } : undefined;
}
