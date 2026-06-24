# Reliability & observability

How Elfaria stays up, recovers from failure, and lets you see what's happening.

## Self-healing — no command or song thing can break the bot

Resilience is layered, so a failure at one level is contained by the next:

- **Commands** → every slash command runs inside try/catch with RED metrics
  (`events/interactionCreate.ts` + `lib/metrics.ts`). An erroring command replies
  with a friendly message and logs the error — it never crashes the process.
- **Events** → `bindEvent` (`events/index.ts`) catches both synchronous throws
  *and* rejected promises per handler, so one bad gateway event (a malformed
  payload, a transient API hiccup) can't kill the event loop.
- **Sources** → source resolution has a **30s timeout** and a **circuit breaker**
  (`lib/circuitBreaker.ts`): after repeated failures it fast-fails for a cooldown
  instead of hammering a struggling Lavalink, then half-opens to retry. The
  **search cache** and **`/lyrics`** are fail-soft (an error there never breaks a
  command). **Lavalink nodes** auto-retry/reconnect.
- **Process** → global `unhandledRejection` / `uncaughtException` handlers plus a
  graceful shutdown (destroys players, closes the DB). The container's restart
  policy is the last backstop.

**Honest caveat:** a true crash bug (e.g. OOM) still relies on the supervisor
restart — software can't make itself *unkillable*, only resilient. The layers
above cover "commands and song things."

## User-facing errors & track failures

Errors are handled where they happen and reported in terms the user can act on:

- **Lyrics** distinguish three outcomes instead of one vague failure
  (`commands/lyrics.ts`): **found** (shown), **not-found** ("LRCLIB may not have
  this track" — a genuine miss, e.g. a remix/live cut), and **service error**
  ("LRCLIB is unavailable, try again" — a 5xx/timeout/network fault). A 404 from
  the exact-match endpoint is a miss, not an outage, so the message is always
  accurate. The fetch is total (never throws); the command still wraps it.
- **A track that errors** (`trackError`) auto-advances and posts a short
  "…skipping to the next" notice.
- **A track that stalls** (`trackStuck`, "the song just died") is surfaced with a
  "stalled and was skipped" notice rather than hanging silently — lavalink-client
  advances the queue; we make it visible.
- **A genuinely broken stream** can't loop forever: `maxErrorsPerTime` is a
  *lenient* backstop (30 errors / 60s) that stops the player only on a real error
  storm. It's deliberately NOT tight: a tighter limit destroys the session on
  transient stalls — and a **throttled** YouTube stream emits `trackStuck` every
  ~10s, so a tight limit makes "the song randomly dies". Individual stuck/errored
  tracks already auto-skip. The real fix for throttling-induced mid-song cut-outs
  is **YouTube OAuth** in `lavalink/application.yml` (`plugins.youtube.oauth`).
- Every command runs inside the instrumented try/catch, so any uncaught error
  becomes a friendly ephemeral reply (`replyError`) and a logged event, never an
  unhandled rejection.

## Every interaction is wrapped + measured

Not just slash commands — **button and select-menu interactions** also run inside
a try/catch and through RED instrumentation (`instrumentComponent`,
`elfaria_component_interactions_total{kind,status}`). So a failing now-playing
button, history page, or queue control is contained and observable exactly like a
command. (The bot's own read-only HTTP API in `lib/api.ts` is a *separate* stats
surface — Discord interactions go through the gateway, not the API.)

## Black-box playback probe (the SLO canary)

A node being TCP-connected doesn't prove it can actually *play* — a broken
YouTube client resolves nothing while the node still shows "connected". So every
~5 minutes the bot runs a real source-resolve against a live node
(`lib/playbackProbe.ts`) and records `elfaria_playback_probe_success` (1/0) +
`elfaria_playback_probe_latency_seconds`. It only resolves (no voice channel
needed) and is near-free. `ElfariaPlaybackProbeFailing` pages when it's been
failing for 15m — catching "playback is broken" before users do, independent of
the node-connected gauge the availability SLO uses.

## 24/7 auto-rejoin on restart

24/7 mode persists its voice/text channel + mode (and any lofi station) to
`app_settings` (`music/rejoin.ts`). On boot, after a node connects, the bot
rejoins voice for every 24/7 guild it owns and resumes the lofi stream — so a
deploy or crash doesn't require re-summoning it. Turning 24/7 off clears the
saved state. (Multi-pod safe: only the pod that owns a guild rejoins it.)

## Distributed tracing (OpenTelemetry)

Opt-in via `OTEL_EXPORTER_OTLP_ENDPOINT` (e.g. `http://otel-collector:4318`).
Auto-instrumentation captures the bot↔Lavalink/Discord HTTP, plus manual spans
on **command execution** and **source resolve** (the bot→Lavalink hop). It's a
zero-cost no-op when disabled, and the (large) SDK is only loaded when tracing
is actually on (`lib/tracing.ts`).

## Circuit breaker + timeout around sources

A 30s resolve timeout, plus a `CircuitBreaker` that fast-fails after repeated
source failures and half-opens after a cooldown. Unit-tested
(`lib/circuitBreaker.test.ts`).

## Graceful Lavalink drain on scale-in

The Lavalink StatefulSet has a `preStop` sleep and a 120s grace period so
in-flight streams get a window before a pod is killed. **Honest:** this *reduces*
cut-offs; Lavalink still can't truly migrate sessions, so scale-in can interrupt
a few streams (mitigated by the HPA's long scale-down window).

## Tests, coverage gate, and CD

- **DB-repo integration tests** (ephemeral SQLite), **command-registry** tests,
  and **circuit-breaker** tests — 32 in total, on Node's built-in runner.
- **Coverage gate** in CI: `npm run test:coverage` fails the build below the
  line/branch/function thresholds (currently ~73% / 88% / 64% of source).
- **CD**: `.github/workflows/release.yml` builds and pushes the image to GHCR on
  a `v*` tag.

## Observability stack

See **[../k8s/monitoring/](../k8s/monitoring/)** for what Prometheus, Grafana,
alerts, and the metrics adapter are and how to wire them — plus the importable
Grafana dashboard and Prometheus alert rules.

## Chaos engineering

See **[../chaos/](../chaos/)** for Chaos Mesh experiments (pod-kill,
network-delay) and a game-day runbook to *prove* the resilience above holds.

## Edge-case bug sweep

The codebase was reviewed against common industry bug classes. Result: clean.

| Class | Result |
|---|---|
| SQL injection | ✅ All queries parameterized (`?` → `$n`); no string interpolation of input. |
| Null/undefined deref | ✅ Every `!` non-null assertion (`tracks[0]!`, `tracks[from-1]!`, …) is guarded by a preceding length/bounds check. |
| Off-by-one | ✅ `/remove` `/skipto` `/move` `/queue` paging all bounds-checked and 1-based-correct. |
| Unhandled rejections | ✅ Global handlers + per-event catch; presence updates can't throw unhandled. |
| Resource/timer leaks | ✅ Progress interval, pause timer, leave timer, resolve timeout all cleared; caches capped (accent 500, autoplay-seen 60) or TTL'd. |
| `JSON.parse` crashes | ✅ All sites wrapped/fail-soft (Redis get, config nodes, deep-clone of own data). |
| ReDoS | ✅ `parseTimestamp` + lyrics `clean()` regexes are linear, inputs short. |
| Interaction double-reply | ✅ `replyError/replyOk` respect deferred/replied state. |
| Div-by-zero | ✅ `progressBar` returns LIVE when duration ≤ 0. |
| Hung downstream | ✅ 30s resolve timeout + circuit breaker. |

## Security & data protection

- **Privacy / GDPR** — see **[../PRIVACY.md](../PRIVACY.md)**: documented data,
  90-day retention (auto-pruned), and `/forget-me` for right-to-erasure.
- **Image scanning** — CI runs **Trivy** on the built image and fails on fixable
  HIGH/CRITICAL CVEs.
- **Network policy** — `k8s/network-policy.yaml` default-denies ingress and only
  allows the bot→Lavalink/Postgres/Redis paths and monitoring→/metrics.
- **Pod hardening** — the bot runs as a non-root user with dropped capabilities,
  no privilege escalation, and the RuntimeDefault seccomp profile.
- **Secrets** — only in gitignored `.env` / K8s `Secret`s (Sealed/External
  Secrets recommended for rotation).
