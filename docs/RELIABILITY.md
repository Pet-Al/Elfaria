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
