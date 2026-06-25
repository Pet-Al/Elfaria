import { type BlendOptions, blend } from './blender.js';
import { collaborativeSignal } from './signals/collaborative.js';
import { nlpSignal } from './signals/nlp.js';
import { popularitySignal } from './signals/popularity.js';
import { sessionSignal } from './signals/session.js';
import type { RankedRecommendation, RecoContext, Signal } from './types.js';

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

/** Build a ranked, de-duplicated recommendation list for the given context. */
export async function recommend(
  ctx: RecoContext,
  opts: BlendOptions = { epsilon: 0.2 },
): Promise<RankedRecommendation[]> {
  return blend(ctx, SIGNALS, opts);
}

export { setAudioFeatureProvider, getAudioFeatureProvider } from './audioFeatures.js';
export type { AudioFeatures, AudioFeatureProvider } from './audioFeatures.js';
export type { Candidate, RankedRecommendation, RecoContext, Signal, SignalName } from './types.js';
