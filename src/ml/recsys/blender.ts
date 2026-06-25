import { audioRerank } from './signals/content.js';
import type { Candidate, RankedRecommendation, RecoContext, Signal } from './types.js';

/**
 * The blender — Elfaria's take on Spotify's BaRT ("Bandits for Recommendations
 * as Treatments"). It fuses the signals two ways:
 *
 *   • EXPLOITATION: weighted score fusion. Each signal's candidates contribute
 *     `signal.weight × candidate.score` to a per-track total, so a track several
 *     signals agree on rises to the top. The content/audio pillar then re-ranks
 *     by how much each result *sounds* like the seed (when a provider is wired).
 *
 *   • EXPLORATION: a fraction (ε) of the slots are reserved for the popularity
 *     arm, so results don't collapse into a filter bubble of the same neighbours
 *     — the bandit's "try something a bit different" behaviour.
 *
 * Every signal is gathered in parallel and is independently fail-soft, so one
 * slow/broken source can't take down a recommendation.
 */

export interface BlendOptions {
  /** Exploration rate ε in [0,1] — share of slots from the popularity arm. */
  epsilon?: number;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export async function blend(
  ctx: RecoContext,
  signals: Signal[],
  opts: BlendOptions = {},
): Promise<RankedRecommendation[]> {
  const epsilon = opts.epsilon ?? 0.2;
  const exclude = new Set<string>(ctx.exclude ?? []);
  if (ctx.seedUri) exclude.add(ctx.seedUri);

  // 1) Gather from every signal in parallel; a thrown signal counts as empty.
  const gathered = await Promise.all(
    signals.map(async (signal) => {
      try {
        return { signal, candidates: await signal.candidates(ctx) };
      } catch {
        return { signal, candidates: [] as Candidate[] };
      }
    }),
  );

  // 2) Weighted score fusion (exploitation).
  const fused = new Map<string, RankedRecommendation>();
  for (const { signal, candidates } of gathered) {
    for (const cand of candidates) {
      if (!cand.uri || exclude.has(cand.uri)) continue;
      const contribution = signal.weight * clamp01(cand.score);
      const existing = fused.get(cand.uri);
      if (existing) {
        existing.blendedScore += contribution;
        existing.title ??= cand.title;
        existing.author ??= cand.author;
        if (!existing.sources.includes(signal.name)) existing.sources.push(signal.name);
      } else {
        fused.set(cand.uri, {
          uri: cand.uri,
          title: cand.title,
          author: cand.author,
          blendedScore: contribution,
          sources: [signal.name],
        });
      }
    }
  }

  // 3) Content/audio re-rank (no-op unless an AudioFeatureProvider is wired in).
  const ranked = await audioRerank(ctx, [...fused.values()]);
  ranked.sort((a, b) => b.blendedScore - a.blendedScore);

  if (ranked.length <= ctx.limit) return ranked;

  // 4) Interleave exploration: reserve ⌊ε·limit⌋ slots for popularity-sourced
  //    picks not already in the exploitation head, then fill the rest in order.
  const exploreQuota = Math.floor(epsilon * ctx.limit);
  if (exploreQuota === 0) return ranked.slice(0, ctx.limit);

  const head = ranked.slice(0, ctx.limit - exploreQuota);
  const chosen = new Set(head.map((r) => r.uri));
  const result = [...head];

  const explorers = ranked.filter((r) => !chosen.has(r.uri) && r.sources.includes('popularity'));
  for (const rec of explorers) {
    if (result.length >= ctx.limit) break;
    result.push(rec);
    chosen.add(rec.uri);
  }
  // Backfill any remaining slots from the exploitation tail.
  for (const rec of ranked) {
    if (result.length >= ctx.limit) break;
    if (!chosen.has(rec.uri)) {
      result.push(rec);
      chosen.add(rec.uri);
    }
  }
  return result;
}
