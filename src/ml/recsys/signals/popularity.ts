import { readDb } from '../../../db/driver.js';
import { logger } from '../../../lib/logger.js';
import type { Candidate, RecoContext, Signal } from '../types.js';

/**
 * Popularity prior — the guild's trending tracks. Two jobs:
 *   1. Cold start: when there's no seed or no history, recommend *something*
 *      sensible (what this server plays most) instead of nothing.
 *   2. Exploration arm: the blender draws from this to break out of the
 *      filter bubble the exploitation signals create (the BaRT "explore" side).
 * Low default weight so it never drowns out personalised signals when those fire.
 */
export const popularitySignal: Signal = {
  name: 'popularity',
  weight: 0.3,
  async candidates(ctx: RecoContext): Promise<Candidate[]> {
    try {
      const rows = await readDb.all<{
        uri: string;
        title: string;
        author: string | null;
        plays: number;
      }>(
        `SELECT uri, MAX(title) AS title, MAX(author) AS author, COUNT(*) AS plays
         FROM events
         WHERE event_type = 'play' AND guild_id = ? AND uri IS NOT NULL
         GROUP BY uri
         ORDER BY plays DESC
         LIMIT 20`,
        [ctx.guildId],
      );
      const max = rows[0]?.plays ?? 1;
      return rows.map((r) => ({
        uri: r.uri,
        title: r.title,
        author: r.author,
        score: Number(r.plays) / max,
        source: 'popularity' as const,
      }));
    } catch (err) {
      logger.debug({ err, guildId: ctx.guildId }, 'popularity signal lookup failed');
      return [];
    }
  },
};
