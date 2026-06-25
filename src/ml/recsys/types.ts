/**
 * Recommendation infrastructure — shared types (doc: docs/RECOMMENDER.md).
 *
 * Elfaria's recommender mirrors Spotify's multi-model approach: several
 * independent SIGNALS each propose scored candidates, and a BaRT-style BLENDER
 * fuses them (exploitation) with an exploration arm. Each signal corresponds to
 * one of Spotify's pillars:
 *   - collaborative  → collaborative filtering (co-play + item2vec embeddings)
 *   - session        → session-based sequence model (what follows, right now)
 *   - content        → content/audio-analysis similarity (sounds alike)
 *   - nlp            → semantic/text (artist, genre, keywords; lyrics later)
 *   - popularity     → global prior for cold start + the exploration arm
 */

export type SignalName = 'collaborative' | 'session' | 'content' | 'nlp' | 'popularity';

/** A single scored recommendation candidate from one signal. */
export interface Candidate {
  uri: string;
  title?: string;
  author?: string | null;
  /** Relevance in [0,1] as scored by the producing signal. */
  score: number;
  /** Which signal proposed it (explainability + per-arm evaluation). */
  source: SignalName;
}

/** Everything a signal needs to produce candidates for one request. */
export interface RecoContext {
  guildId: string;
  userId?: string;
  /** The track to recommend *from* (the currently-playing / last / top track). */
  seedUri?: string;
  seedTitle?: string;
  seedAuthor?: string | null;
  /** Recent in-session play URIs, most-recent LAST (the session model's input). */
  sessionUris?: string[];
  /** URIs to exclude from results (already queued, the seed, the "seen" set). */
  exclude?: Iterable<string>;
  /** How many recommendations to return. */
  limit: number;
}

/** One recommendation source. MUST be fail-soft — return [] on any error. */
export interface Signal {
  readonly name: SignalName;
  /** Default exploitation weight in the blend (BaRT exploitation term). */
  readonly weight: number;
  candidates(ctx: RecoContext): Promise<Candidate[]>;
}

/** A blended, ranked recommendation (the blender's output). */
export interface RankedRecommendation {
  uri: string;
  title?: string;
  author?: string | null;
  /** Fused score across all contributing signals (after any audio rerank). */
  blendedScore: number;
  /** Every signal that proposed this track (explainability). */
  sources: SignalName[];
}
