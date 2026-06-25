import { readDb } from '../../../db/driver.js';
import { logger } from '../../../lib/logger.js';
import type { Candidate, RecoContext, Signal } from '../types.js';

/**
 * NLP / semantic pillar (scaffold). Spotify runs NLP over lyrics, web articles
 * and the billions of user playlists a track appears in to build a semantic
 * "cultural vector" (themes, genre, vibe) — which is how it relates songs that
 * no one has co-played yet.
 *
 * We don't crawl the web, so this starts with the strongest *cheap* semantic
 * link we already have: the artist. Tracks by the same author as the seed are a
 * reliable, zero-cost semantic neighbour. The interface is the seam: swap this
 * body for real text embeddings (title/lyrics/playlist-name vectors) and the
 * blender consumes them unchanged.
 */
export const nlpSignal: Signal = {
  name: 'nlp',
  weight: 0.5,
  async candidates(ctx: RecoContext): Promise<Candidate[]> {
    const author = ctx.seedAuthor?.trim();
    if (!author) return [];
    try {
      const rows = await readDb.all<{
        uri: string;
        title: string;
        author: string | null;
        plays: number;
      }>(
        `SELECT uri, MAX(title) AS title, MAX(author) AS author, COUNT(*) AS plays
         FROM events
         WHERE event_type = 'play' AND author = ? AND uri IS NOT NULL AND uri <> ?
         GROUP BY uri
         ORDER BY plays DESC
         LIMIT 10`,
        [author, ctx.seedUri ?? ''],
      );
      return rows.map((r, i) => ({
        uri: r.uri,
        title: r.title,
        author: r.author,
        score: 0.8 - i / 15,
        source: 'nlp' as const,
      }));
    } catch (err) {
      logger.debug({ err, guildId: ctx.guildId }, 'nlp signal lookup failed');
      return [];
    }
  },
};
