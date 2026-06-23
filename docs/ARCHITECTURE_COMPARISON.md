# Elfaria vs. production service architecture

A grounded comparison of Elfaria's design against the patterns used by
large-scale systems (Discord, Netflix) and the standard pillars of a production
software service (12-factor, SRE, CI/CD, MLOps). The goal is **not** to claim
parity — a hobby music bot and a planet-scale streaming service operate six
orders of magnitude apart. The goal is to map *which patterns* Elfaria already
embodies, which it stubs, and which it omits, so the gap to "production-grade" is
explicit and prioritised rather than hand-waved.

Every claim below points at real code so it can be verified, not taken on faith.

---

## The reference points

| System | What's instructive about it |
|---|---|
| **Discord (backend)** | Gateway **sharding** (a connection can't carry unlimited guilds), stateful real-time fan-out, consistent-hashing to route guilds to processes, polyglot services (Elixir/Erlang for fan-out, Rust for hot paths), ScyllaDB for storage. Relevant because Elfaria *is* a Discord client and inherits the sharding constraint. |
| **Netflix** | Hundreds of **stateless microservices**, autoscaling groups, aggressive **caching/CDN** (Open Connect), deep **observability** (metrics/tracing), **chaos engineering** (Chaos Monkey), and a **data/ML platform** (the recommender, A/B at scale). The canonical "operationally mature distributed system." |
| **12-factor / SRE / MLOps** | The vendor-neutral checklist: config in env, stateless processes, disposability, logs as streams, build/release/run separation; SLIs/SLOs/error budgets; CI→CD with progressive delivery; data pipelines and model lifecycle. |

Altitude note: Elfaria is a **single small service plus an offloaded audio tier**.
Comparing it to Netflix is like comparing a well-built food truck to a restaurant
chain — the same disciplines (hygiene, supply chain, consistency) apply, just at
wildly different scale. The interesting question is *which disciplines are present
at all*.

---

## Feature matrix

Legend: ✅ have · 🟡 partial / stubbed · ❌ missing

### 1. Architecture & decomposition

| Capability | Status | Evidence / gap |
|---|---|---|
| Separation of concerns (gateway vs. heavy compute) | ✅ | Audio sourcing/transcoding/streaming is offloaded to **Lavalink**; the bot only orchestrates (`src/music/player.ts`, `src/music/sources.ts`). This is the same "don't do CPU-heavy work in the latency-sensitive process" split Discord/Netflix live by. |
| Stateless application tier | ✅ | The bot holds no durable state in-process; settings/playlists live in the DB, cache in Redis. A pod can be killed and replaced freely. |
| Clear module boundaries | ✅ | `commands/`, `events/`, `music/`, `db/`, `cache/`, `lib/` — single-responsibility layers, dialect-agnostic data access. |
| Service mesh / API gateway / multiple services | ❌ | One app + one audio service. No inter-service mesh, mTLS, or gateway — unnecessary at this scale. |

### 2. Configuration & 12-factor

| Capability | Status | Evidence / gap |
|---|---|---|
| Config strictly from environment | ✅ | `src/config.ts` validates all config at boot; secrets never hardcoded. |
| Build/release/run separation | ✅ | Multi-stage `Dockerfile`; image is the immutable release artifact. |
| Disposability / fast startup-shutdown | ✅ | Graceful `closeDatabase()`; fail-soft config (a bad `LAVALINK_NODES` warns instead of crashing). |
| Dev/prod parity | 🟡 | Docker compose mirrors prod topology, but the **default** path is SQLite/single-process while prod is Postgres/sharded — intentional, but parity isn't 1:1. |

### 3. Horizontal scaling

| Capability | Status | Evidence / gap |
|---|---|---|
| Gateway sharding | ✅ | `src/shard.ts` runs the bot under discord.js `ShardingManager` — the same hard requirement Discord imposes (~2,500 guilds/shard). |
| Audio tier autoscaling | ✅ | `k8s/lavalink-hpa.yaml` scales Lavalink pods on CPU; the bot pre-declares one node per pod and balances across live ones. This is genuine demand-driven horizontal scaling of the expensive tier. |
| Load balancing across backends | ✅ | `lavalink-client` routes each new player to the least-loaded node (`src/client.ts` node pool). Analogous to a least-connections LB. |
| Multi-region / geo-routing | ❌ | Single region. Netflix's Open Connect / multi-region failover has no analogue here (and isn't warranted). |
| Bot tier autoscaling across pods | 🟡 | In-process sharding works; multi-**pod** shard splitting (coordinated `SHARD_LIST`) is documented but not implemented (`k8s/README.md` caveats). |

### 4. Data & caching

| Capability | Status | Evidence / gap |
|---|---|---|
| Durable store with migrations | ✅ | `src/db/driver.ts` — SQLite **and** Postgres behind one async interface, schema migration on boot. |
| Pluggable engine (embedded → networked) | ✅ | `DATABASE_URL` switches SQLite→Postgres with no code change — the "start simple, scale the data tier later" pattern. |
| Shared cache layer | ✅ | `src/cache/search.ts` — in-memory or Redis, chosen by `REDIS_URL`; fail-soft (a cache error never breaks a search). TTL'd. The same "cache the expensive upstream call" Netflix does with EVCache. |
| Connection pooling | ✅ | `pg` Pool in the Postgres driver. |
| Read replicas / sharded DB / CQRS | ❌ | Single primary. No replicas, partitioning, or read/write split — not needed at this volume. |

### 5. Resilience & reliability

| Capability | Status | Evidence / gap |
|---|---|---|
| Retries with backoff | ✅ | Lavalink node reconnects (`retryAmount`/`retryDelay` in `src/client.ts`); push/network retry guidance in ops. |
| Graceful degradation | ✅ | Redis down → falls back to memory cache; bad node config → falls back to single node; Spotify creds absent → other sources still work. |
| Health probes | ✅ | Lavalink readiness/liveness probes (`k8s/lavalink-statefulset.yaml`). |
| Circuit breakers / bulkheads | ✅ | `lib/circuitBreaker.ts` fast-fails source resolution after repeated failures (+ a 30s timeout), then half-opens. |
| Session migration on scale-in | ❌ | Removing a Lavalink pod drops its players (documented honestly in `k8s/README.md`). Netflix-grade drain-then-terminate is absent. |
| Chaos engineering | ✅ | Chaos Mesh experiments (pod-kill, network-delay) + a game-day runbook in `chaos/`. |
| Defined SLIs/SLOs/error budgets | ❌ | No reliability targets are measured. |

### 6. Observability

| Capability | Status | Evidence / gap |
|---|---|---|
| Structured logging | ✅ | `pino` with structured fields throughout (`src/lib/logger.ts`); logs as a stream (12-factor). |
| Metrics (RED/USE) | ✅ | Prometheus `/metrics` (`src/lib/metrics.ts`): command RED metrics, process defaults, cache hit/miss, resolve latency, and live player/node gauges. HPA autoscales on `elfaria_active_players`; Grafana dashboard + alerts in `k8s/monitoring/`. |
| Distributed tracing | ✅ | OpenTelemetry (opt-in via `OTEL_EXPORTER_OTLP_ENDPOINT`): auto-instrumentation + manual command/resolve spans (`lib/tracing.ts`). |
| Dashboards & alerting | ✅ | Grafana dashboard + Prometheus alert rules in `k8s/monitoring/`. |

### 7. Delivery & quality

| Capability | Status | Evidence / gap |
|---|---|---|
| CI: lint + typecheck + image build | ✅ | `.github/workflows/ci.yml` runs ESLint, `tsc --noEmit`, and a Docker build on every push/PR. |
| Static typing end-to-end | ✅ | TypeScript strict mode. |
| Automated tests (unit/integration) | ✅ | `node:test` suite (34): pure helpers, card structure, loop/circuit-breaker logic, **DB-repository integration** tests, command registry. CI **coverage gate** (~73% lines). **Remaining:** broader command-handler tests, load testing. |
| Load / soak testing | ❌ | No synthetic load harness to validate the HPA thresholds. |
| Continuous **Deployment** (CD) | 🟡 | `release.yml` builds + pushes the image to GHCR on `v*` tags. **Remaining:** canary/blue-green (needs multi-replica bot). |

### 8. Security

| Capability | Status | Evidence / gap |
|---|---|---|
| Secrets hygiene | ✅ | Credentials only in gitignored `.env` / K8s `Secret`; `.example` templates tracked; least-privilege gateway intents. |
| Non-root container, minimal image | ✅ | Runs as `node` user on a slim base (`Dockerfile`). |
| Secret management & rotation | 🟡 | Plain K8s Secret; README points to Sealed Secrets / External Secrets but rotation isn't automated. |
| Network policies / RBAC / image scanning | ✅ | Trivy image scan in CI, `k8s/network-policy.yaml` default-deny, pod `securityContext` (non-root, dropped caps, seccomp). **Remaining:** automated secret rotation. |

### 9. Data science & ML

| Capability | Status | Evidence / gap |
|---|---|---|
| Recommendation / autoplay | 🟡 | Co-play **collaborative filter** on the event stream (`analytics/recommend.ts`) with a YouTube-mix fallback. Learns from data, but not yet a trained model. |
| Event/analytics pipeline | ✅ | Structured play/skip/search events to the DB, optionally published to **Kafka** (`analytics/events.ts`). Powers the recommender + public stats API. |
| Experimentation (A/B) | ❌ | No experiment framework. |
| Event/analytics pipeline | ✅ | Structured events → DB (+ optional Kafka), `analytics/events.ts`. |
| Recommendation (learned) | 🟡 | Co-play collaborative filter (`analytics/recommend.ts`); a trained model is the next step (needs accumulated data). |
| Capacity forecasting / anomaly detection | ❌ | Scaling is reactive (CPU threshold), not predictive. No forecasting on historical load. |

---

## The data-science angle, concretely

Where a Netflix-style data practice *would* plug into Elfaria — and what it'd take:

1. **Autoplay → learned recommender.** Today's heuristic could become a model
   trained on (skip, replay, queue-add) signals. Requires the event pipeline
   below first — you can't train without logged interactions. Even a simple
   collaborative-filter on co-play counts would beat "play the YouTube mix."
2. **Event pipeline.** Emit a structured event per play/skip/search (the
   `pino` logger is already structured — pipe to Kafka/Kinesis → warehouse).
   This single addition unlocks recommendations, dashboards, and A/B testing.
3. **Predictive autoscaling.** Lavalink load is highly diurnal (evenings/weekends
   spike). A time-series forecast (even Holt-Winters) could pre-warm pods
   *before* the spike instead of chasing CPU after it — the difference between
   reactive and proactive capacity. This is exactly the
   `lavalink_playing_players` metric the HPA already references.
4. **Anomaly detection on metrics.** Once metrics exist, simple statistical
   alerting (e.g. error-rate z-score) replaces "someone noticed the logs."

The throughline: **almost every DS/ML capability is blocked on the same two
missing primitives — metrics and an event stream.** Build those and a lot opens
up at once.

---

## Summary: what actually separates Elfaria from "production-grade"

Elfaria already implements the **architectural** patterns of a scalable service:
stateless app tier, offloaded compute, horizontal scaling (sharding + audio HPA),
load balancing, a pluggable data tier, a shared cache, graceful degradation, and
config/secrets hygiene. Architecturally, it's shaped like the real thing.

Most of the original gaps are now closed: ✅ metrics + tracing, ✅ dashboards +
alerts, ✅ tests + coverage gate, ✅ event/analytics pipeline (+ Kafka), ✅
circuit breaker, ✅ chaos experiments, ✅ image scanning + network policy + pod
hardening, ✅ a public stats API, ✅ a co-play recommender, ✅ GDPR `/forget-me`
+ retention. What genuinely remains (and is **not** a rewrite):

1. **A trained recommender (neural/embedding model)** — the co-play CF and the
   event stream are the foundation; a learned model needs accumulated data and a
   train/serve loop (offline training + an inference step).
2. **SLIs/SLOs + error budgets** — the metrics exist; define targets and alert on
   burn rate.
3. **Multi-pod bot sharding** + **progressive delivery** (canary/blue-green).
4. **Multi-region / Postgres HA / read replicas** — only when scale demands it.
5. **Automated secret rotation** and **load/soak testing**.

The honest headline has shifted: Elfaria is now **built like a scalable system
and operated like one too** — the remaining items are scale-and-maturity polish,
not missing fundamentals. Progress is tracked in [ROADMAP.md](./ROADMAP.md).

> Scope caveat: this is a design-level comparison. The scaling features are
> verified to *function* (see README "Verifying the scale-out features"); they
> have not been load-tested at scale, and the Kubernetes manifests have not been
> applied to a live cluster.
