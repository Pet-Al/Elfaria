/**
 * item2vec — skip-gram with negative sampling (SGNS), the same shallow neural
 * net behind word2vec, applied to listening sessions instead of sentences
 * (doc roadmap #6, "trained recommender"). Each track URI is a "word"; a
 * "sentence" is a sequence of tracks played together in a guild. Training learns
 * a dense embedding per track such that tracks that co-occur in sessions land
 * close together — so "what should play next" becomes a nearest-neighbour lookup
 * in embedding space rather than a hand-written heuristic.
 *
 * Pure and dependency-free (no native BLAS, no Python): a few epochs of SGD over
 * the events is plenty for a music bot's data, and it runs anywhere tsx does.
 * Deterministic given a seed, so the behaviour is unit-testable.
 */

export interface SgnsOptions {
  /** Embedding dimensionality. */
  dim?: number;
  /** Context window (each side). */
  window?: number;
  /** Negative samples per positive. */
  negatives?: number;
  /** Training passes over the corpus. */
  epochs?: number;
  /** Initial learning rate (linearly decayed to ~0). */
  learningRate?: number;
  /** Drop tokens appearing fewer than this many times. */
  minCount?: number;
  /** PRNG seed (determinism). */
  seed?: number;
}

export interface SgnsModel {
  dim: number;
  /** token → embedding vector (the input/"target" matrix rows). */
  vectors: Map<string, Float32Array>;
}

const DEFAULTS: Required<Omit<SgnsOptions, 'seed'>> & { seed: number } = {
  dim: 48,
  window: 3,
  negatives: 5,
  epochs: 5,
  learningRate: 0.025,
  minCount: 2,
  seed: 1,
};

/** mulberry32 — a tiny, fast, seedable PRNG so training is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sigmoid(x: number): number {
  if (x >= 6) return 1;
  if (x <= -6) return 0;
  return 1 / (1 + Math.exp(-x));
}

/**
 * Train SGNS embeddings on a corpus of sessions (each an ordered list of track
 * URIs). Returns one vector per surviving token.
 */
export function trainSgns(sessions: string[][], options: SgnsOptions = {}): SgnsModel {
  const opts = { ...DEFAULTS, ...options };
  const rng = mulberry32(opts.seed);

  // 1. Vocabulary + frequencies.
  const freq = new Map<string, number>();
  for (const session of sessions) {
    for (const token of session) freq.set(token, (freq.get(token) ?? 0) + 1);
  }
  const vocab = [...freq.entries()].filter(([, c]) => c >= opts.minCount).map(([t]) => t);
  const index = new Map(vocab.map((t, i) => [t, i]));
  const V = vocab.length;
  if (V < 2) return { dim: opts.dim, vectors: new Map() };

  // Encode sessions as index arrays (dropping out-of-vocab tokens).
  const corpus: number[][] = sessions
    .map((s) => s.map((t) => index.get(t)).filter((i): i is number => i !== undefined))
    .filter((s) => s.length >= 2);

  // 2. Negative-sampling table over freq^0.75 (the word2vec unigram distribution).
  const TABLE = Math.min(1_000_000, Math.max(1000, V * 100));
  const negTable = new Int32Array(TABLE);
  {
    const pow = vocab.map((t) => (freq.get(t) ?? 0) ** 0.75);
    const total = pow.reduce((a, b) => a + b, 0);
    let i = 0;
    let cum = pow[0]! / total;
    for (let a = 0; a < TABLE; a++) {
      negTable[a] = i;
      if (a / TABLE > cum && i < V - 1) {
        i++;
        cum += pow[i]! / total;
      }
    }
  }

  // 3. Init: input ("target") matrix small-random, output matrix zero.
  const Win = new Float32Array(V * opts.dim);
  const Wout = new Float32Array(V * opts.dim);
  for (let i = 0; i < Win.length; i++) Win[i] = (rng() - 0.5) / opts.dim;

  // 4. Train.
  const grad = new Float32Array(opts.dim);
  const totalPairs = Math.max(1, opts.epochs * corpus.reduce((a, s) => a + s.length, 0));
  let done = 0;

  for (let epoch = 0; epoch < opts.epochs; epoch++) {
    for (const session of corpus) {
      for (let i = 0; i < session.length; i++) {
        const lr = opts.learningRate * Math.max(1 - done / totalPairs, 1e-4);
        done++;
        const center = session[i]!;
        const cOff = center * opts.dim;
        // Dynamic window (word2vec shrinks it randomly to weight near context).
        const w = 1 + Math.floor(rng() * opts.window);
        for (let j = Math.max(0, i - w); j <= Math.min(session.length - 1, i + w); j++) {
          if (j === i) continue;
          const context = session[j]!;
          grad.fill(0);
          // 1 positive (the real context) + N negatives.
          for (let n = 0; n <= opts.negatives; n++) {
            let target: number;
            let label: number;
            if (n === 0) {
              target = context;
              label = 1;
            } else {
              target = negTable[Math.floor(rng() * TABLE)]!;
              if (target === context) continue;
              label = 0;
            }
            const tOff = target * opts.dim;
            let dot = 0;
            for (let d = 0; d < opts.dim; d++) dot += Win[cOff + d]! * Wout[tOff + d]!;
            const g = lr * (label - sigmoid(dot));
            for (let d = 0; d < opts.dim; d++) {
              grad[d]! += g * Wout[tOff + d]!;
              Wout[tOff + d]! += g * Win[cOff + d]!;
            }
          }
          for (let d = 0; d < opts.dim; d++) Win[cOff + d]! += grad[d]!;
        }
      }
    }
  }

  // 5. Extract per-token vectors from the input matrix.
  const vectors = new Map<string, Float32Array>();
  for (let i = 0; i < V; i++) {
    vectors.set(vocab[i]!, Win.subarray(i * opts.dim, (i + 1) * opts.dim).slice());
  }
  return { dim: opts.dim, vectors };
}

/** Cosine similarity between two equal-length vectors. */
export function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Top-k most similar tokens to `token` by cosine similarity (excludes itself). */
export function mostSimilar(
  model: SgnsModel,
  token: string,
  k = 10,
): { token: string; score: number }[] {
  const seed = model.vectors.get(token);
  if (!seed) return [];
  const scored: { token: string; score: number }[] = [];
  for (const [other, vec] of model.vectors) {
    if (other === token) continue;
    scored.push({ token: other, score: cosine(seed, vec) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
