import { readFile } from 'node:fs/promises';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { type SgnsModel, mostSimilar } from './sgns.js';
import type { TrackMeta } from './dataset.js';

/**
 * Inference-serve side of the trained recommender (doc roadmap #6). The offline
 * trainer (`scripts/train-recommender.ts`) writes an embeddings artifact; this
 * loads it into memory once at boot and answers "tracks similar to this one" as
 * a nearest-neighbour lookup in embedding space. Autoplay calls it FIRST, ahead
 * of the co-play heuristic and the YouTube-mix fallback.
 *
 * Entirely optional and fail-soft: with no artifact (cold start, model not
 * trained yet) it simply returns nothing and the heuristics take over.
 */

export interface ModelArtifact {
  version: number;
  dim: number;
  trainedAt: string;
  count: number;
  vectors: Record<string, number[]>;
  meta: Record<string, TrackMeta>;
}

export interface Recommendation {
  uri: string;
  title: string;
  author: string | null;
}

let model: SgnsModel | null = null;
let meta: Map<string, TrackMeta> = new Map();
let loadedAt: string | null = null;

/** True once a trained model is loaded and ready to serve. */
export function isRecommenderReady(): boolean {
  return model !== null && model.vectors.size > 0;
}

/** Metadata about the loaded model (for /metrics, diagnostics). */
export function recommenderInfo(): { ready: boolean; count: number; trainedAt: string | null } {
  return { ready: isRecommenderReady(), count: model?.vectors.size ?? 0, trainedAt: loadedAt };
}

/**
 * Load (or reload) the embeddings artifact from disk. Safe to call anytime;
 * a missing or malformed file just leaves the recommender disabled.
 */
export async function loadRecommender(path = config.recommender.modelPath): Promise<boolean> {
  try {
    const raw = await readFile(path, 'utf8');
    const artifact = JSON.parse(raw) as ModelArtifact;
    if (!artifact.vectors || !artifact.dim) throw new Error('artifact missing vectors/dim');

    const vectors = new Map<string, Float32Array>();
    for (const [uri, vec] of Object.entries(artifact.vectors)) {
      vectors.set(uri, Float32Array.from(vec));
    }
    model = { dim: artifact.dim, vectors };
    meta = new Map(Object.entries(artifact.meta ?? {}));
    loadedAt = artifact.trainedAt ?? null;
    logger.info(
      { count: vectors.size, dim: artifact.dim, trainedAt: loadedAt },
      'recommender model loaded',
    );
    return true;
  } catch (err) {
    // ENOENT is the normal "not trained yet" case — log it quietly.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      logger.info({ path }, 'no recommender model found (heuristics only) — run `npm run train`');
    } else {
      logger.warn({ err, path }, 'failed to load recommender model — heuristics only');
    }
    return false;
  }
}

/**
 * Tracks similar to `seedUri` per the trained embeddings, best first. Returns []
 * when the model isn't loaded or the seed isn't in the vocabulary (cold track) —
 * the caller then falls back to its heuristics.
 */
export function recommendTracks(seedUri: string, k = 10): Recommendation[] {
  if (!model) return [];
  return mostSimilar(model, seedUri, k).map(({ token }) => ({
    uri: token,
    title: meta.get(token)?.title ?? token,
    author: meta.get(token)?.author ?? null,
  }));
}

/** Test/utility hook: install a model directly without touching disk. */
export function __setModelForTest(m: SgnsModel | null, metaMap?: Map<string, TrackMeta>): void {
  model = m;
  meta = metaMap ?? new Map();
  loadedAt = m ? new Date().toISOString() : null;
}
