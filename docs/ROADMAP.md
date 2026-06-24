# Elfaria roadmap — closing the operational-maturity gap

A living checklist derived from the gap analysis in
[ARCHITECTURE_COMPARISON.md](./ARCHITECTURE_COMPARISON.md). Elfaria already has
the *architecture* of a scalable service; this tracks the *operational* layers
that separate it from production-grade. Items are in **priority order** (highest
leverage first). Check them off as they land; keep the comparison doc's matrix in
sync.

Legend: ✅ done · 🟡 in progress / partial · ⬜ not started

---

## Priority gaps (from the comparison matrix)

- 🟡 **1. Metrics + tracing** — *highest leverage; unblocks autoscaling on the right signal and data science.*
  - ✅ Prometheus `/metrics` endpoint (`src/lib/metrics.ts`): command RED metrics
    (`elfaria_commands_total`, `elfaria_command_duration_seconds`), process
    defaults, and gauges for `elfaria_active_players` / `elfaria_lavalink_nodes_connected`.
  - ✅ Wired into the command router (`instrumentCommand`) and started on ready.
  - ✅ K8s scrape annotations + metrics port on the bot Deployment.
  - ✅ Player-count autoscaling: the Lavalink HPA scales on `elfaria_active_players`
    (External metric) with CPU as a safety net; wiring (bot Service, ServiceMonitor,
    Prometheus Adapter rule) lives in `k8s/monitoring/`.
  - ✅ Search cache hit/miss + resolve-latency metrics.
  - ✅ Grafana dashboard + Prometheus alert rules (`k8s/monitoring/`).
  - ✅ Distributed tracing (OpenTelemetry, opt-in via OTEL_EXPORTER_OTLP_ENDPOINT)
    — auto-instrumentation + manual command/resolve spans (`src/lib/tracing.ts`).

- 🟡 **2. Automated tests** — *types and lint catch shape errors, not behaviour.*
  - ✅ `node:test` suite (34) in CI: pure helpers, card structure, loop +
    circuit-breaker logic, **DB-repository integration** tests, command registry.
  - ✅ Coverage reporting + threshold **gate** (`npm run test:coverage`).
  - ✅ Load/soak tests (k6) for the public API with SLO-mirroring thresholds
    (`load/`), plus HPA-validation guidance.
  - ⬜ Broader command-handler tests with a mocked interaction.

- ✅ **3. Event / analytics pipeline** — *unblocks recommendations, dashboards, A/B.*
  - ✅ Structured play/skip/search events to the `events` table (`analytics/events.ts`).
  - ✅ Optional **Kafka** publish (KAFKA_BROKERS, `analytics/kafka.ts`).
  - ✅ Privacy: `/forget-me` erasure + `PRIVACY.md` + 90-day retention prune.

- ✅ **4. Continuous Deployment** — *CI builds, release publishes.*
  - ✅ Push the image to GHCR on a `v*` tag (`.github/workflows/release.yml`).
  - ✅ Progressive rollout: multi-pod StatefulSet + `RollingUpdate` partition for
    canary→full promotion (`k8s/bot-statefulset.yaml`, `docs/SCALING_SHARDING.md`).

- 🟡 **5. Resilience depth**
  - ✅ Timeout (30s) + circuit breaker around source resolution
    (`src/lib/circuitBreaker.ts`, wired in `music/sources.ts`).
  - ✅ Graceful Lavalink drain on scale-in (preStop sleep + longer grace period;
    reduces cut-offs, not full session migration).
  - ✅ Self-healing: every event handler wrapped (errors logged, never crash the
    loop); commands wrapped; global handlers; fail-soft cache/lyrics.
  - ✅ Chaos experiments + game-day runbook (`chaos/` — Chaos Mesh pod-kill &
    network-delay). Documented in `docs/RELIABILITY.md`.

- ✅ **6. Autoplay: heuristic → personalised/learned**
  - ✅ Heuristic autoplay: YouTube mix radio for all sources, anti-repeat.
  - ✅ Preference signal captured (the event pipeline) + a **co-play collaborative
    filter** (`analytics/recommend.ts`), tried before the YouTube-mix fallback.
  - ✅ `/forget-me` erasure (per-user data).
  - ✅ **Trained model** — item2vec/SGNS embeddings (`src/ml/`), offline trainer
    (`npm run train`) + inference-serve loaded on boot; autoplay uses it first.
  - ✅ Autoplay **buffer** (fills several tracks ahead) + **/reroll** randomiser.

- ✅ **7. Security hardening**
  - ✅ Image scanning (Trivy) in CI — fails on fixable HIGH/CRITICAL CVEs.
  - ✅ K8s `NetworkPolicy` (default-deny) + pod `securityContext` (non-root, dropped
    caps, seccomp).
  - ✅ Published privacy policy (`PRIVACY.md`) + data-retention prune.
  - ✅ Automated secret rotation (External Secrets Operator, `k8s/external-secrets.yaml`).

- ✅ **8. Service levels & scale-out**
  - ✅ SLIs/SLOs + error budgets + multi-window burn-rate alerts (`docs/SLO.md`,
    `k8s/monitoring/prometheus-slo-rules.yaml`).
  - ✅ Multi-pod sharding with coordinated shard ranges (`src/lib/shardRange.ts`,
    `k8s/bot-statefulset.yaml`).
  - ✅ Postgres HA + read replicas (`k8s/postgres-ha.yaml`, `DATABASE_REPLICA_URL`);
    multi-region guidance in `docs/DATA.md`.

---

## How to use this list

This is the continuous-development backlog. Each landed change should: tick the
box here, flip the matching row in `ARCHITECTURE_COMPARISON.md`, and add/extend a
test where it makes sense.

---

## Next up — working notes (living)

State as of this writing: all work is on branch `claude/dazzling-hamilton-ca1gua`
(no open PR yet). Docker now defaults to a bundled Postgres shared across the
small and scale stacks; SQLite remains only for a non-Docker `npm start`.

**Decided / shipped recently**
- Components V2 now-playing card; single panel that updates **in place** per
  track (reposts only when the channel has moved on); buried panels greyed
  (accent kept); the **final** panel (queue finished) carries a one-shot Replay.
  `/play` is ephemeral and just refreshes the card's "up next".
- Loop = dropdown with track/queue × once/infinite. Volume = compact −25/+25
  buttons (no full-width row). Live progress interval is configurable
  (`NOWPLAYING_REFRESH_MS`, 0 = off).
- History/replay/favorites; player-count HPA wiring (`k8s/monitoring/`).
- New commands: `/seek`, `/skipto`, `/clear`, `/move`, `/summon` (vc move),
  `/lyrics` (lyrics.ovh, no plugin). Skip/next now runs autoplay when enabled.
- DB-repo + command-registry tests; CI coverage gate (`npm run test:coverage`);
  CD release workflow (`.github/workflows/release.yml`, builds image on tags).
- Every leave (idle/pause/empty/stop) now greys the card AND keeps a Replay button.
- Panel volume is session-only (reverts to the saved default when the bot leaves);
  /volume still sets the persistent default. Autoplay now uses YouTube's mix radio
  for ALL sources (genre-aware, not same-artist-only) with anti-repeat.
- Event pipeline (DB + optional Kafka), co-play recommender, public stats API
  (`/api/*`), `/forget-me` + PRIVACY.md + retention, Trivy scan + NetworkPolicy +
  pod hardening. Commands are now GLOBAL by default (`deploy:guild` for dev).
- Fixed: autoplay/skip now advances via autoplay instead of stopping; /lyrics
  switched from the dead lyrics.ovh to LRCLIB (now also parses "Artist - Title").
- Dynamic **seek dropdown** (10s steps that scale with track length, ≤25 options).
- Commands now **auto-register globally on boot** (AUTO_DEPLOY_COMMANDS) — no
  manual deploy step; only the pod owning shard 0 does it.
- **Trained item2vec recommender** (`src/ml/`, `npm run train`) used first by
  autoplay; **autoplay buffer** + **/reroll**. **SLIs/SLOs + burn-rate alerts**
  (`docs/SLO.md`). **Multi-pod sharding** + canary partition rollouts. **Postgres
  HA + read replicas** (`DATABASE_REPLICA_URL`). **External Secrets** rotation.
  **k6 load/soak** harness. Full **data architecture** doc (`docs/DATA.md`).
- Latest batch: **command-dupe reconcile** (idempotent global deploy + always
  clear the guild copy) + owner-only **/admin** toggles (retention, /forget-me);
  now-playing **⏮️ back** button, panel **expiry on crash/kick**, **favorite on
  expired cards**; **/lofi** + **/247** (leaves only when alone); **anti-clipping
  EQ** (fixes static); autoplay shows in queue **ahead** + **dequeues on off**;
  precise **lyrics** errors + **trackStuck** handling + error-rate cap; **paginated
  history** + **replay picker**; **/help**; **/queue** paging; **cross-pod presence
  via Redis** (the sharding bug — fixed); persisted autoplay per guild.
- Latest batch: **lofi fixed** for real (Lavalink YouTube clients now include
  TVHTML5EMBEDDED/MWEB so the 24/7 live stations resolve); **/247 → /24-7** with
  `until-empty`/`forever`/`off` modes; **24/7 auto-rejoin on restart** (persists
  channel + mode + lofi station, rejoins on boot — `music/rejoin.ts`); **black-box
  playback probe** SLO canary (`lib/playbackProbe.ts` + alert); **all component
  interactions instrumented** (RED metrics, not just commands); **/replay <#>**
  integer param; **/dequeue**, **/filter-save**, **/status**; 30-min button expiry.
- Latest batch (the "next big 5"): **configurable error backstop** (default 10/60s,
  no more session-killing on throttle stalls); **queue persistence / session
  migration** (DB queue store, restored on 24/7 rejoin); **A/B framework**
  (`analytics/experiments.ts`, live recommender-ordering experiment); **predictive
  autoscaling** (`predict_linear` forecast rules) + **anomaly detection** (player
  drop + z-score command-rate); **broader command-handler tests**.

- Latest batch (the proposed "next big 5", all shipped): **KEDA predictive
  autoscaling** (`k8s/keda-scaledobject.yaml`); **end-to-end play canary**
  (`lib/playCanary.ts`, joins a staging VC + verifies position advances);
  **web dashboard** (`/` on the public API); **nightly train/serve** CronJob
  (`k8s/train-cronjob.yaml`) + recommender hot-reload + model metrics;
  **synced lyrics** on the now-playing card (`lib/lyrics.ts`).

**Still genuinely remaining (honest)**
- Cross-region active/active failover (only at much larger scale); per-line
  lyric scrolling needs a faster card refresh than the global API budget allows
  (it updates at the refresh cadence, ~15s, not per line); the play canary needs
  a dedicated staging guild to be useful.

**Possible next directions (not committed)**
- Slash-command i18n / localization; a richer web dashboard (per-guild
  now-playing, queue control) behind auth; user-level taste profiles for the
  recommender; sponsor-block-style segment skipping; voice-activity "DJ handoff".
- Idle-leave when a play resolves nothing (broken/unsupported link); pause
  inactivity leave (don't sit paused in voice forever).
- Resilience: a 30s timeout around source resolution so a hung source can't
  block a command. Observability: cache/resolve metrics + Grafana + alerts.
- Volume is a dropdown again (25 increments); loop is a dropdown too.
- Presence: Streaming "music in N servers", count aggregated across shards and
  refreshed on guild join/leave (fixes per-shard undercount + staleness).
- Sharding entrypoint hardened: `SHARD_COUNT` always resolves to `auto` or an
  int ≥ 1 (no "minimum 1" crash); `SHARDING=off` ⇒ a single shard.
- Removed dead code (`cycleLoop`). SQLite kept intentionally for non-Docker dev.

**Open items / assumptions (next)**
1. **One-off SQLite → Postgres migration** script — existing `./data/*.db` rows
   don't carry into the new Postgres store; offer a copy script.
2. **`/forget-me` + a short privacy notice** — favorites & history are per-user
   data; self-service deletion + disclosure is the responsible follow-up.
3. **Event/analytics pipeline** (#3) → unblocks personalised autoplay (#6).
4. **Large-scale updates** — at very high guild counts set `NOWPLAYING_REFRESH_MS=0`
   (live edits don't fit the global API budget). Cross-shard guild count is done.
5. **Observability finish** — Grafana dashboard, alert rules, OpenTelemetry traces.
6. **Tests/CI** — command-handler + DB-repository tests, coverage gate; then CD.
7. **Security** — image scanning, NetworkPolicy, secret rotation, privacy policy.

**Won't do (by request / platform limits)**
- Per-user "lit" favorite button — message components are shared across all
  viewers, so a per-clicker highlight isn't possible; the ⭐ confirms via an
  ephemeral reply instead.

**Notes / answers captured**
- Twitch is a **native** Lavalink source (not redirected to YouTube like
  Spotify metadata) — Twitch stream URLs play directly.
- Volume is **guild-specific** (persisted per guild, applied to that player).
- The 3s edit throttle is about politeness/efficiency, not ban-avoidance —
  discord.js already queues and respects 429s, so there's no ban risk.
