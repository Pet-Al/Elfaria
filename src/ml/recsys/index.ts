import { type BlendOptions, blend } from './blender.js';
import { collaborativeSignal } from './signals/collaborative.js';
import { nlpSignal } from './signals/nlp.js';
import { popularitySignal } from './signals/popularity.js';
import { sessionSignal } from './signals/session.js';
import type { RankedRecommendation, RecoContext, Signal, SignalName } from './types.js';

/**
 * Recommendation orchestrator (doc: docs/RECOMMENDER.md).
 *
 * The single entrypoint the bot calls. It assembles the active signals and runs
 * them through the BaRT-style blender. Add a pillar by dropping a Signal into
 * this list — the blender and every caller pick it up automatically.
 *
 * The content/audio pillar isn't a generator (it re-ranks inside the blender),
 * so it's not listed here; it activates as soon as an AudioFeatureProvider is
 * wired via setAudioFeatureProvider().
 */
export const SIGNALS: Signal[] = [
  collaborativeSignal,
  sessionSignal,
  nlpSignal,
  popularitySignal,
];

export interface RecommendOptions extends BlendOptions {
  /**
   * Restrict to these signals only. Used to keep results genre-consistent: with
   * a real seed we run the seed-aware signals (collaborative/session/nlp) and
   * leave OUT popularity, which otherwise injects the guild's overall favourites
   * regardless of the seed's genre (the "EDM seed → lofi results" problem).
   */
  only?: SignalName[];
}

/** Build a ranked, de-duplicated recommendation list for the given context. */
export async function recommend(
  ctx: RecoContext,
  opts: RecommendOptions = { epsilon: 0.2 },
): Promise<RankedRecommendation[]> {
  const active = opts.only ? SIGNALS.filter((s) => opts.only!.includes(s.name)) : SIGNALS;
  return blend(ctx, active, opts);
}

export { setAudioFeatureProvider, getAudioFeatureProvider } from './audioFeatures.js';
export type { AudioFeatures, AudioFeatureProvider } from './audioFeatures.js';
export type { Candidate, RankedRecommendation, RecoContext, Signal, SignalName } from './types.js';
