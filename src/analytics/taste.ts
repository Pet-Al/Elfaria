import { readDb } from '../db/driver.js';
import { logger } from '../lib/logger.js';

/**
 * Per-user taste profiles (doc roadmap). Autoplay's co-play CF and the trained
 * item2vec model both learn the GUILD's collective taste; this adds the missing
 * personal signal — what *this listener* actually plays — so when someone queues
 * a song, autoplay can lean toward the kind of music they reach for, and
 * /recommend has something to suggest even with no current track.
 *
 * It's a lightweight aggregation over the same `events` stream (no new tables):
 * a user's most-played distinct tracks, most recent first as a tiebreak. Reads
 * go to the replica when configured (heavy analytics, off the hot path).
 */

export interface TasteTrack {
  uri: string;
  title: string;
  author: string | null;
  plays: number;
}

/** A user's most-played distinct tracks (across all guilds), most-played first. */
export async function userTopTracks(userId: string, limit = 10): Promise<TasteTrack[]> {
  try {
    const rows = await readDb.all<{
      uri: string;
      title: string;
      author: string | null;
      plays: number;
    }>(
      `SELECT uri, MAX(title) AS title, MAX(author) AS author,
              COUNT(*) AS plays
       FROM events
       WHERE event_type = 'play' AND user_id = ? AND uri IS NOT NULL
       GROUP BY uri
       ORDER BY plays DESC, MAX(created_at) DESC
       LIMIT ?`,
      [userId, limit],
    );
    return rows.map((r) => ({
      uri: r.uri,
      title: r.title,
      author: r.author,
      plays: Number(r.plays),
    }));
  } catch (err) {
    logger.warn({ err, userId }, 'user taste lookup failed');
    return [];
  }
}

/**
 * A user's favourite artists (most-played authors), strongest first. Useful for
 * a one-line "your top artists" in /recommend and for seeding a fresh search
 * when we have no track to start from.
 */
export async function userTopAuthors(userId: string, limit = 5): Promise<string[]> {
  try {
    const rows = await readDb.all<{ author: string; plays: number }>(
      `SELECT author, COUNT(*) AS plays
       FROM events
       WHERE event_type = 'play' AND user_id = ? AND author IS NOT NULL AND author <> ''
       GROUP BY author
       ORDER BY plays DESC
       LIMIT ?`,
      [userId, limit],
    );
    return rows.map((r) => r.author);
  } catch (err) {
    logger.warn({ err, userId }, 'user top-authors lookup failed');
    return [];
  }
}
