import { featureSimilarity, getAudioFeatureProvider } from '../audioFeatures.js';
import type { RankedRecommendation, RecoContext } from '../types.js';

/**
 * Content / audio-analysis pillar (re-ranker form).
 *
 * Unlike the other signals it doesn't *generate* candidates — without a global
 * nearest-neighbour index over feature space it can't enumerate "all tracks that
 * sound like X". Instead it RE-RANKS the pool the other signals produced,
 * boosting tracks whose audio features sit close to the seed's. That's the
 * cheap, honest version of the content pillar: it sharpens ordering by *sound*
 * whenever an AudioFeatureProvider is wired in, and is a no-op otherwise.
 *
 * With a feature index (precomputed neighbours, like Spotify's) this would also
 * contribute candidates — a natural next step behind the same provider seam.
 */
const BOOST = 0.5; // max multiplicative lift for a perfectly-matching track

export async function audioRerank(
  ctx: RecoContext,
  ranked: RankedRecommendation[],
): Promise<RankedRecommendation[]> {
  const provider = getAudioFeatureProvider();
  if (!provider || !ctx.seedUri || ranked.length === 0) return ranked;

  const seed = await provider.get(ctx.seedUri).catch(() => null);
  if (!seed) return ranked;

  await Promise.all(
    ranked.map(async (rec) => {
      const feats = await provider.get(rec.uri).catch(() => null);
      if (!feats) return; // unknown → leave the exploitation score untouched
      const sim = featureSimilarity(seed, feats); // 0..1
      rec.blendedScore *= 1 + BOOST * sim;
      if (!rec.sources.includes('content')) rec.sources.push('content');
    }),
  );
  return ranked;
}
