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
  - ✅ Starter suite on the built-in `node:test` runner (no extra deps), wired
    into CI: `formatDuration`, `progressBar`, the now-playing card structure,
    `toPg` placeholder conversion (`src/**/*.test.ts`).
  - ⬜ Command-handler tests with a mocked interaction.
  - ⬜ DB repository tests against an ephemeral SQLite/Postgres.
  - ⬜ Coverage reporting + a threshold gate in CI.

- ⬜ **3. Event / analytics pipeline** — *unblocks recommendations, dashboards, A/B all at once.*
  - ⬜ Emit a structured event per play / skip / search (the `pino` logger is
    already structured — add a dedicated event channel).
  - ⬜ Ship events to a sink (Kafka/Kinesis → warehouse, or start with a table).
  - ⬜ Privacy: opt-in/disclosure + a `/forget-me` deletion command (see below).

- ⬜ **4. Continuous Deployment** — *CI builds but doesn't deploy.*
  - ⬜ Push the image to a registry on tag/release.
  - ⬜ Progressive rollout (the K8s Deployment already uses a controlled strategy;
    add canary/blue-green for the bot once it's multi-replica).

- 🟡 **5. Resilience depth**
  - ✅ Timeout (30s) + circuit breaker around source resolution
    (`src/lib/circuitBreaker.ts`, wired in `music/sources.ts`).
  - ✅ Graceful Lavalink drain on scale-in (preStop sleep + longer grace period;
    reduces cut-offs, not full session migration).
  - ✅ Self-healing: every event handler wrapped (errors logged, never crash the
    loop); commands wrapped; global handlers; fail-soft cache/lyrics.
  - ✅ Chaos experiments + game-day runbook (`chaos/` — Chaos Mesh pod-kill &
    network-delay). Documented in `docs/RELIABILITY.md`.

- 🟡 **6. Autoplay: heuristic → personalised/learned**
  - ✅ Heuristic autoplay today (`src/music/autoplay.ts`): YouTube mix radio /
    artist-title search.
  - ⬜ Per-user/guild preference signal captured (needs the event pipeline first).
  - ⬜ Simple co-play collaborative filter, then evaluate a learned recommender.

  - ⬜ `/forget-me` deletion command — **now relevant**: the ⭐ favorites feature
    stores per-user data (`favorites` table), so a self-service wipe + a short
    privacy note are the responsible next step.

- ⬜ **7. Security hardening**
  - ⬜ Image scanning (Trivy/Snyk) in CI.
  - ⬜ K8s `NetworkPolicy` + pod security context tightening.
  - ⬜ Automated secret rotation (Sealed Secrets / External Secrets Operator).
  - ⬜ Published privacy policy + data-retention limits.

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
