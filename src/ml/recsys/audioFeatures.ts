/**
 * Audio-analysis pillar — perceptual feature schema + a pluggable provider.
 *
 * This mirrors Spotify's track audio-features: a small vector describing how a
 * track *sounds*, independent of who listened to it. It's the cold-start-proof
 * signal — a brand-new song with zero plays can still be matched to similar
 * music by its audio alone (Spotify trains a CNN on the raw audio to predict
 * exactly these features for catalog cold start).
 *
 * We define the schema and the provider seam now; the real numbers come from a
 * provider you wire in:
 *   - Spotify's get-audio-features API (track metadata bridged via LavaSrc), or
 *   - an on-box model over the decoded audio (a CNN on the mel-spectrogram, the
 *     approach Spotify itself uses for cold start).
 * Until a provider is set the content signal stays dark (returns nothing) and
 * the blender simply skips the audio rerank — no behaviour change, just a seam.
 */

/** Spotify-style perceptual audio features. 0..1 unless noted. */
export interface AudioFeatures {
  /** 0..1 confidence the track is acoustic. */
  acousticness: number;
  /** 0..1 suitability for dancing (tempo/rhythm stability/beat strength). */
  danceability: number;
  /** 0..1 perceptual intensity & activity (fast/loud/noisy → 1). */
  energy: number;
  /** 0..1 likelihood of no vocals (>0.5 ≈ instrumental). */
  instrumentalness: number;
  /** 0..1 presence of a live audience (>0.8 ≈ live). */
  liveness: number;
  /** 0..1 presence of spoken words (rap/podcast → higher). */
  speechiness: number;
  /** 0..1 musical positiveness (happy/cheerful → 1, sad/angry → 0). */
  valence: number;
  /** Overall loudness in dB (≈ -60..0); normalised when compared. */
  loudness: number;
  /** Estimated tempo in BPM; normalised when compared. */
  tempo: number;
  /** Pitch class 0..11 (C..B), or -1 if unknown. */
  key: number;
  /** Modality: 1 major, 0 minor. */
  mode: number;
}

/**
 * A source of per-track audio features. Real implementations: the Spotify
 * audio-features API, or an on-box spectrogram CNN. Return null when unknown.
 */
export interface AudioFeatureProvider {
  readonly name: string;
  get(uri: string): Promise<AudioFeatures | null>;
}

let provider: AudioFeatureProvider | null = null;

/** Wire in (or clear) the audio-feature provider — lights up the content pillar. */
export function setAudioFeatureProvider(p: AudioFeatureProvider | null): void {
  provider = p;
}
export function getAudioFeatureProvider(): AudioFeatureProvider | null {
  return provider;
}

// The comparable, scale-normalised slice of the vector. loudness/tempo/key are
// rescaled to ~0..1 so every dimension contributes evenly to the distance.
function toVector(f: AudioFeatures): number[] {
  return [
    f.acousticness,
    f.danceability,
    f.energy,
    f.instrumentalness,
    f.liveness,
    f.speechiness,
    f.valence,
    Math.min(Math.max((f.loudness + 60) / 60, 0), 1), // -60..0 dB → 0..1
    Math.min(Math.max(f.tempo / 250, 0), 1), // 0..250 BPM → 0..1
    f.key >= 0 ? f.key / 11 : 0.5, // unknown key → neutral
    f.mode, // already 0/1
  ];
}

/**
 * Similarity in [0,1] between two feature vectors (1 = identical sound). A
 * normalised Euclidean distance turned into a similarity — robust and cheap.
 */
export function featureSimilarity(a: AudioFeatures, b: AudioFeatures): number {
  const va = toVector(a);
  const vb = toVector(b);
  let sumSq = 0;
  for (let i = 0; i < va.length; i += 1) {
    const d = (va[i] ?? 0) - (vb[i] ?? 0);
    sumSq += d * d;
  }
  const dist = Math.sqrt(sumSq / va.length); // 0..1 (vector is normalised)
  return 1 - dist;
}
