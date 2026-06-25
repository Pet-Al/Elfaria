import { coPlayedAfter } from '../../../analytics/recommend.js';
import type { Candidate, RecoContext, Signal } from '../types.js';

/**
 * Session-based pillar. Spotify weights what you're listening to *right now* far
 * more than your all-time history — a late-night session shouldn't be steered by
 * last week's gym playlist. This is a lightweight stand-in for that sequence
 * model: it looks at the last few in-session tracks and accumulates "what tends
 * to follow them", weighting the MOST RECENT track highest. With a real sequence
 * model (e.g. a GRU over the session) this same interface returns its next-item
 * distribution instead.
 */
const RECENT_WINDOW = 3;

export const sessionSignal: Signal = {
  name: 'session',
  weight: 0.8,
  async candidates(ctx: RecoContext): Promise<Candidate[]> {
    const seq = ctx.sessionUris ?? [];
    if (seq.length === 0) return [];
    const recent = seq.slice(-RECENT_WINDOW);

    const acc = new Map<string, { cand: Candidate; weight: number }>();
    for (let i = 0; i < recent.length; i += 1) {
      const recency = (i + 1) / recent.length; // most recent → 1.0
      const co = await coPlayedAfter(ctx.guildId, recent[i]!, 10).catch(() => []);
      co.forEach((r, j) => {
        const contribution = recency * (1 - j / (co.length + 2));
        const existing = acc.get(r.uri);
        if (existing) existing.weight += contribution;
        else
          acc.set(r.uri, {
            cand: { uri: r.uri, title: r.title, author: r.author, score: 0, source: 'session' },
            weight: contribution,
          });
      });
    }
    if (acc.size === 0) return [];

    const max = Math.max(...[...acc.values()].map((v) => v.weight));
    return [...acc.values()].map((v) => ({ ...v.cand, score: max > 0 ? v.weight / max : 0 }));
  },
};
