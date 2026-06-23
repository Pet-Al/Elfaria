import { db } from './driver.js';

/**
 * Per-user favorites repository (doc roadmap, "save/favorite button").
 *
 * The ⭐ button on the now-playing panel toggles the current track in the
 * clicking user's favorites; /favorites lists and replays them. This is per-user
 * data — keep it minimal (title/uri/author only) and deletable (toggle removes,
 * and a future /forget-me wipes a user's rows).
 */

export interface Favorite {
  title: string;
  uri: string;
  author: string | null;
}

/**
 * Toggle a track in a user's favorites: add it if absent, remove it if present.
 * Returns which happened so the caller can word the reply.
 */
export async function toggleFavorite(
  userId: string,
  track: { title: string; uri: string; author?: string | null },
): Promise<'added' | 'removed'> {
  const existing = await db.get<{ id: number }>(
    'SELECT id FROM favorites WHERE user_id = ? AND uri = ?',
    [userId, track.uri],
  );
  if (existing) {
    await db.run('DELETE FROM favorites WHERE id = ?', [existing.id]);
    return 'removed';
  }
  await db.run('INSERT INTO favorites (user_id, title, uri, author) VALUES (?, ?, ?, ?)', [
    userId,
    track.title,
    track.uri,
    track.author ?? null,
  ]);
  return 'added';
}

/** A user's favorites, newest first. */
export async function listFavorites(userId: string, limit = 25): Promise<Favorite[]> {
  const rows = await db.all<{ title: string; uri: string; author: string | null }>(
    'SELECT title, uri, author FROM favorites WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    [userId, limit],
  );
  return rows.map((r) => ({ title: r.title, uri: r.uri, author: r.author }));
}
