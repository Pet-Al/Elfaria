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
  - ⬜ Per-node player metrics from Lavalink (Prometheus plugin) → switch the HPA
    from CPU to the `lavalink_playing_players` Pods metric via Prometheus Adapter.
  - ⬜ Distributed tracing (OpenTelemetry spans across bot → Lavalink).
  - ⬜ Grafana dashboard + alert rules.

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

- ⬜ **5. Resilience depth**
  - ⬜ Circuit breaker / timeout budget around source resolution.
  - ⬜ Graceful Lavalink drain on scale-in (preStop that waits for players).
  - ⬜ Fault-injection / chaos test in a staging cluster.

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
test where it makes sense. The two highest-leverage items (metrics, tests) are
already underway — the next natural pulls are the **Prometheus Adapter HPA wiring**
(completes #1) and the **event pipeline** (#3, which in turn unblocks #6).
