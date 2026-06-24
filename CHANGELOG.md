# Changelog

Notable changes, newest first. Elfaria is pre-1.0 and on a single rolling branch
(`claude/dazzling-hamilton-ca1gua`); these are grouped by work batch rather than
semver tags. See [docs/REFERENCE.md](./docs/REFERENCE.md) for the full reference
and [docs/GUIDE.md](./docs/GUIDE.md) to get started.

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
