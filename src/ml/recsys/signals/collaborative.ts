import { coPlayedAfter } from '../../../analytics/recommend.js';
import { recommendTracks } from '../../recommender.js';
import type { Candidate, RecoContext, Signal } from '../types.js';

/**
 * Collaborative-filtering pillar. Two complementary CF views of the same idea
 * ("tracks that go with this track, learned from listening behaviour"):
 *   - the trained **item2vec** embeddings (cosine neighbours of the seed), and
 *   - the guild's raw **co-play** sequence ("what played next after this here").
 * The item2vec model generalises across guilds; co-play captures this server's
 * own taste. Both already exist — this just exposes them as a blendable signal.
 */
export const collaborativeSignal: Signal = {
  name: 'collaborative',
  weight: 1.0,
  async candidates(ctx: RecoContext): Promise<Candidate[]> {
    if (!ctx.seedUri) return [];
    const out: Candidate[] = [];

    try {
      const trained = recommendTracks(ctx.seedUri, 15);
      trained.forEach((r, i) =>
        out.push({
          uri: r.uri,
          title: r.title,
          author: r.author,
          score: 1 - i / (trained.length + 1), // rank-decayed
          source: 'collaborative',
        }),
      );
    } catch {
      // no model loaded / lookup miss — fall through to co-play
    }

    try {
      const co = await coPlayedAfter(ctx.guildId, ctx.seedUri, 15);
      co.forEach((r, i) =>
        out.push({
          uri: r.uri,
          title: r.title,
          author: r.author,
          score: 0.9 - i / (co.length + 2),
          source: 'collaborative',
        }),
      );
    } catch {
      // analytics hiccup — return whatever the model gave us
    }

    return out;
  },
};
