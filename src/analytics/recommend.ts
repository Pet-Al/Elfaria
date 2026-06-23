import { db } from '../db/driver.js';
import { logger } from '../lib/logger.js';

/**
 * Co-play recommender (doc roadmap #6) — a first, real step from heuristic to
 * learned recommendations.
 *
 * Collaborative filtering on the event stream: "in this guild, what track most
 * often played right AFTER this one?" Computed with a window function (LEAD over
 * plays ordered by time), so it learns the guild's actual listening sequences.
 * Cold start (no data) returns nothing and the caller falls back to the YouTube
 * mix. This is the bridge to a future trained model — same signal, fancier math.
 */

export interface CoPlayed {
  uri: string;
  title: string;
  author: string | null;
}

export async function coPlayedAfter(guildId: string, seedUri: string, limit = 5): Promise<CoPlayed[]> {
  try {
    const rows = await db.all<{ uri: string; title: string; author: string | null; c: number }>(
      `WITH seq AS (
         SELECT
           uri,
           LEAD(uri)   OVER (PARTITION BY guild_id ORDER BY created_at, id) AS next_uri,
           LEAD(title) OVER (PARTITION BY guild_id ORDER BY created_at, id) AS next_title,
           LEAD(author)OVER (PARTITION BY guild_id ORDER BY created_at, id) AS next_author
         FROM events
         WHERE event_type = 'play' AND guild_id = ?
       )
       SELECT next_uri AS uri, next_title AS title, next_author AS author, COUNT(*) AS c
       FROM seq
       WHERE uri = ? AND next_uri IS NOT NULL AND next_uri <> ?
       GROUP BY next_uri, next_title, next_author
       ORDER BY c DESC
       LIMIT ?`,
      [guildId, seedUri, seedUri, limit],
    );
    return rows.map((r) => ({ uri: r.uri, title: r.title, author: r.author }));
  } catch (err) {
    logger.warn({ err, guildId }, 'co-play lookup failed');
    return [];
  }
}
