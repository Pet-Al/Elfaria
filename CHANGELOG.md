# Changelog

Notable changes, newest first. Elfaria is pre-1.0 and on a single rolling branch
(`claude/dazzling-hamilton-ca1gua`); these are grouped by work batch rather than
semver tags. See [docs/REFERENCE.md](./docs/REFERENCE.md) for the full reference
and [docs/GUIDE.md](./docs/GUIDE.md) to get started.

## Per-second cards, per-track favorites, lofi themes & the next 5

- **Now-playing updates every second** — `NOWPLAYING_REFRESH_MS` defaults to
  `1000` (was 15000) so the progress timer **and** the synced-lyrics line tick
  live. The lyric line is driven entirely by this refresh, not a separate timer.
  At large scale raise it (one edit per active guild per second eats the ~50
  req/s global budget) or set `0` to disable live updates.
- **↩️ Replay button** added to the live card's utility row (right of 🔀 Shuffle).
- **Favorite/Replay target the card you clicked** — each card remembers its own
  track, so pressing ⭐/↩️ on an **older** card saves/replays *that* song, not
  whatever is playing now (was: always the current track).
- **Guild commands removed entirely** — Elfaria is **global-only** now; the
  guild-scoped registration path (the sole cause of doubled commands) is gone.
  `deploy:guild`/`deploy:global` scripts removed; the bot still clears any
  orphaned guild copies on boot (`CLEAR_ALL_GUILD_COMMANDS`).
- **`/lofi` is now per-theme** — `theme:` choices (chill/study/sleep/jazz/
  chillhop/synthwave/rainy), each its own search seed. Livestreams are filtered
  out (only one of the 24/7 radios reliably resolved), and continuity comes from
  **autoplay** instead of a forced queue-loop — fixes "never ends / loops the
  last 3 songs".
- **Next 5:**
  - **SponsorBlock** — `/sponsorblock on|off` skips sponsor/intro/outro/
    off-topic segments via the Lavalink SponsorBlock plugin (per-guild, persisted).
  - **User taste profiles** — autoplay now blends in a low-weight slice of the
    requester's own most-played tracks (`analytics/taste.ts`).
  - **`/recommend`** — queues picks made for you from the trained model +
    co-play + your taste, falling back to your top artist.
  - **i18n scaffold** (`lib/i18n.ts`) — `t(key, locale)` with en/es/fr/de and
    English fallback; router messages localise to the user's Discord language.
  - **Playlist name autocomplete** — `/playlist load`/`delete` suggest your own
    saved playlists, so they're usable without typing the exact name.

## Player UX & lyrics polish

- **Lyrics reliability** — LRCLIB lookups now use a 12s timeout + one retry on
  timeout/5xx. A transient timeout used to surface as "lyrics unavailable"; that
  was the long-standing "lyrics don't work".
- **`/lofi`** now loads a curated YouTube **playlist** (shuffled, queue-looped)
  instead of the 24/7 live streams the YouTube clients struggled to resolve.
- **Filters** — `/filter-save` merged into `/filter` as an optional `save:true`;
  added a **`vocal`** clarity preset (presence-band lift for singing).
- **`/dequeue` → `/autoplay-dequeue`.**
- **Now-playing card** — "up next" uses `#1` numbering; **every** retired card
  (buried/superseded, not just the final one) keeps a working Replay + Favorite,
  each with its own ~30-min expiry. Back no longer re-queues the current track
  (fixes the replay+back duplicate).
- **Doubled commands** — opt-in `CLEAR_ALL_GUILD_COMMANDS` nukes leftover
  guild-scoped commands on boot.
- **`/about`** — a one-screen tech-stack / architecture brief.
- **Boot-crash fix** — the DB queue store had to be a class (lavalink-client
  validates the prototype's methods), else the client crashed on every start.

## Data-science "big 5"

- **KEDA predictive autoscaling** (`k8s/keda-scaledobject.yaml`) on the
  `predict_linear` player forecast, with a reactive safety trigger.
- **End-to-end play canary** (`lib/playCanary.ts`) — joins a staging VC, plays a
  track, verifies the position advances (real audio), exports
  `elfaria_play_canary_success`.
- **Web dashboard** — the public API serves a read-only HTML page at `/`.
- **Nightly train/serve** (`k8s/train-cronjob.yaml`) + recommender hot-reload +
  `elfaria_recommender_*` metrics.
- **Synced lyrics** on the now-playing card (current line, from LRCLIB).
- Plus: configurable error backstop (`MAX_TRACK_ERRORS`, default 10/60s),
  **queue persistence / session migration** (DB queue store, restored on rejoin),
  **A/B framework** (`analytics/experiments.ts`), forecast + **anomaly alerts**.

## Reliability & "song randomly dies"

- The error-storm backstop (`maxErrorsPerTime`) was destroying the player on
  transient **YouTube throttling** stalls. Loosened + made configurable; the real
  fix (YouTube **OAuth**) is documented in `lavalink/application.yml`.

## Modes, history & ownership

- **`/24-7`** (renamed from `/247`) with `until-empty` / `forever` / `off`, plus
  **auto-rejoin on restart** (persists channel + mode).
- **`/replay [position]`** — integer index into history (default most recent).
- **`/history`** — unlimited & paginated (jump dropdown + Prev/Next).
- **`/status`** — live health inside Discord; **owner `/admin`** toggles
  (retention deletion, `/forget-me` access).
- Now-playing **back button**, panel expiry on crash/kick, favourite on expired
  cards; **autoplay** shows ahead in the queue + dequeues on off.
- **Lofi & 24/7** groundwork, anti-clipping EQ, robust stuck-track handling.

## Scale, ML & platform foundations

- Dynamic **seek dropdown**; auto-global command registration (idempotent).
- **Trained item2vec recommender** (offline train + inference serve).
- **SLIs/SLOs + burn-rate alerts**; **multi-pod sharding** + canary; **Postgres
  HA / read replicas**; **External Secrets** + **k6** load/soak; cross-pod
  presence via Redis.
- Full **data architecture** docs, Kafka event pipeline, public stats API, GDPR.
