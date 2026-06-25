# Recommender — Elfaria's Spotify-style multi-model architecture

This documents how Elfaria recommends music: the design, how it mirrors
Spotify's published approach, what is **live** today vs. **scaffolded** behind a
seam, and the roadmap to richer models. Code lives in
[`src/ml/recsys/`](../src/ml/recsys), with the offline-trained embeddings in
[`src/ml/recommender.ts`](../src/ml/recommender.ts) and
[`src/ml/sgns.ts`](../src/ml/sgns.ts).

---

## How Spotify does it (the model we mirror)

Spotify doesn't use one algorithm — it **blends several models**, each covering a
different blind spot, behind a bandit that decides what to actually show you.

1. **Collaborative filtering (CF).** The backbone. It builds a map of taste from
   behaviour — "people/playlists that group these tracks together" — over a
   sample of ~700M user playlists. Great when a track has plays; useless for a
   brand-new song (the **cold-start problem**).
2. **NLP / content text.** Models over lyrics, web-crawled articles, blog posts,
   and the names of the billions of playlists a track appears in, to extract a
   semantic "cultural vector" (themes, genre, vibe). Relates songs no one has
   co-played yet.
3. **Raw audio analysis.** A **CNN over the raw audio** predicts perceptual
   features so a song with **zero** listening data can still be placed next to
   things that *sound* like it. These are the public **audio-features**:
   `acousticness, danceability, energy, instrumentalness, liveness, speechiness,
   valence, loudness (dB), tempo (BPM), key (0–11), mode (major/minor),
   time_signature`. The lower-level **audio-analysis** goes further —
   `segments` (consistent-sound slices, each with a 12-D **timbre** vector and a
   12-D **pitch/chroma** vector), plus `beats`, `bars`, `tatums`, and `sections`.
4. **Session awareness.** What you're playing *right now* is weighted far more
   than your all-time history — a sequence model over the current session.
5. **BaRT** ("Bandits for Recommendations as Treatments") is the ranker that ties
   it together: an **exploitation** arm (give you what the models predict you'll
   engage with) balanced against an **exploration** arm (try something new), as a
   multi-armed bandit optimising long-run engagement.

Sources:
[music-tomorrow deep-dive](https://music-tomorrow.com/blog/how-spotify-recommendation-system-works-complete-guide),
[BaRT overview](https://dynamoi.com/learn/faqs/what-is-spotify-bart-algorithm),
[Spotify audio-features API](https://developer.spotify.com/documentation/web-api/reference/get-audio-features),
[Spotify audio-analysis API](https://developer.spotify.com/documentation/web-api/reference/get-audio-analysis).

---

## How Elfaria mirrors it

Same shape: independent **signals** each propose scored candidates; a BaRT-style
**blender** fuses them with an exploration arm. One signal ≈ one Spotify pillar.

| Pillar (Spotify) | Elfaria signal | Status | Implementation |
|---|---|---|---|
| Collaborative filtering | `collaborative` | **live** | item2vec embeddings (`recommender.ts`) + per-guild co-play CF (`analytics/recommend.ts`) |
| Session model | `session` | **live (heuristic)** | recency-weighted "what follows the last few in-session tracks" |
| NLP / semantic | `nlp` | **live (scaffold)** | same-artist neighbours today; seam for lyrics/web/playlist-name embeddings |
| Audio analysis | `content` | **seam** | feature schema + `AudioFeatureProvider`; re-ranks by audio similarity once a provider is wired |
| Popularity / exploration | `popularity` | **live** | guild trending; powers cold start + the bandit's explore arm |
| BaRT ranker | `blender.ts` | **live** | weighted score fusion (exploit) + ε exploration slots |

### Data flow

```
RecoContext (seed, user, session, exclude, limit)
        │
        ├── collaborative ─┐
        ├── session ───────┤  candidates() in parallel, fail-soft
        ├── nlp ───────────┤
        └── popularity ────┘
                  │ weighted score fusion  (Σ weightᵢ · scoreᵢ per track)
                  ▼
            audio re-rank   (content pillar; ×(1+0.5·sim) when a provider exists)
                  │
            ε-exploration   (reserve ⌊ε·limit⌋ slots for the popularity arm)
                  ▼
        RankedRecommendation[]  →  /recommend resolves to playable tracks
```

Each signal implements the same tiny contract
([`types.ts`](../src/ml/recsys/types.ts)) and **must be fail-soft** — one slow or
broken source returns `[]`, never an error, so a recommendation always comes
back. Add a pillar by dropping a `Signal` into `SIGNALS`
([`index.ts`](../src/ml/recsys/index.ts)); the blender and every caller pick it
up automatically.

### The audio pillar seam

We define Spotify's exact feature vector ([`audioFeatures.ts`](../src/ml/recsys/audioFeatures.ts))
and an `AudioFeatureProvider` interface, but ship **no** provider — so the
content signal is dark and the blender skips the audio re-rank (zero behaviour
change). Wire one of these to light it up:

- **Spotify audio-features API** — cheapest path; bridge the metadata via LavaSrc
  and implement `get(uri)`.
- **On-box CNN** — the cold-start-proof route Spotify itself uses: decode the
  audio, compute a mel-spectrogram, run a small CNN to predict the feature
  vector. No external dependency, works for any source.

```ts
import { setAudioFeatureProvider } from './ml/recsys/index.js';
setAudioFeatureProvider({ name: 'spotify', async get(uri) { /* … */ } });
```

With a provider **and** a precomputed nearest-neighbour index over feature space,
the content pillar graduates from re-ranker to full generator (Spotify-style
content cold start) behind the same interface.

---

## Where it's used

- **`/recommend`** runs the full orchestrator and queues the top picks.
- **Autoplay** (`music/autoplay.ts`) still uses its proven direct path
  (item2vec → co-play → personal taste → YouTube mix) and already blends a
  per-user **taste profile** (`analytics/taste.ts`). Migrating autoplay onto the
  orchestrator is the natural next step — same signals, one ranker.

## Honesty about status

This is a **production-grade skeleton with honest stand-ins**, not a claim to
match Spotify's scale. The CF pillar is genuinely trained (item2vec/SGNS); the
session, NLP, and popularity signals are real but heuristic; the audio pillar is
a fully-wired seam awaiting a feature provider. The value is the **architecture**
— the moment you add a model behind a seam, it ranks through the same blender
with no caller changes.

## Roadmap

1. Wire an `AudioFeatureProvider` (Spotify API first, CNN later) → content pillar live.
2. Real text embeddings for the `nlp` signal (titles/lyrics/playlist names).
3. A sequence model (e.g. GRU/transformer over session events) for `session`.
4. Per-signal weight tuning via the A/B framework (`analytics/experiments.ts`)
   using skip-rate as the reward — closing the BaRT bandit loop with real feedback.
