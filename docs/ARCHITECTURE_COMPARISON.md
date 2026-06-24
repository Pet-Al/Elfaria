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
| Multi-region / geo-routing | 🟡 | Single region by default; the read-replica split + a CNPG replica-per-region pattern is documented (`docs/DATA.md`), but no automated geo-routing/failover orchestration ships. |
| Bot tier autoscaling across pods | ✅ | Multi-**pod** sharding with coordinated, disjoint shard ranges (`src/lib/shardRange.ts`, `k8s/bot-statefulset.yaml`): ordinal × `SHARDS_PER_POD` → shard ids clipped to `TOTAL_SHARDS`. See `docs/SCALING_SHARDING.md`. |

### 4. Data & caching

| Capability | Status | Evidence / gap |
|---|---|---|
| Durable store with migrations | ✅ | `src/db/driver.ts` — SQLite **and** Postgres behind one async interface, schema migration on boot. |
| Pluggable engine (embedded → networked) | ✅ | `DATABASE_URL` switches SQLite→Postgres with no code change — the "start simple, scale the data tier later" pattern. |
| Shared cache layer | ✅ | `src/cache/search.ts` — in-memory or Redis, chosen by `REDIS_URL`; fail-soft (a cache error never breaks a search). TTL'd. The same "cache the expensive upstream call" Netflix does with EVCache. |
| Connection pooling | ✅ | `pg` Pool in the Postgres driver. |
| Read replicas / sharded DB / CQRS | 🟡 | **Read replica + read/write split** done: `DATABASE_REPLICA_URL` routes heavy analytics reads to a replica (`src/db/driver.ts` `readDb`), with an HA cluster manifest (`k8s/postgres-ha.yaml`). DB partitioning / full CQRS not warranted at this volume. |

### 5. Resilience & reliability

| Capability | Status | Evidence / gap |
|---|---|---|
| Retries with backoff | ✅ | Lavalink node reconnects (`retryAmount`/`retryDelay` in `src/client.ts`); push/network retry guidance in ops. |
| Graceful degradation | ✅ | Redis down → falls back to memory cache; bad node config → falls back to single node; Spotify creds absent → other sources still work. |
| Health probes | ✅ | Lavalink readiness/liveness probes (`k8s/lavalink-statefulset.yaml`). |
| Circuit breakers / bulkheads | ✅ | `lib/circuitBreaker.ts` fast-fails source resolution after repeated failures (+ a 30s timeout), then half-opens. |
| Session migration on scale-in | 🟡 | The **queue persists** to the DB (`music/queueStore.ts`) and is restored on 24/7 auto-rejoin (`queue.utils.sync()`), so a restart keeps the playlist. Lavalink still can't migrate a *mid-stream* audio session between nodes, so a track restarts from the top rather than resuming mid-song. |
| Chaos engineering | ✅ | Chaos Mesh experiments (pod-kill, network-delay) + a game-day runbook in `chaos/`. |
| Defined SLIs/SLOs/error budgets | ✅ | Command-success, latency & playback-availability SLOs with 28d error budgets and **multi-window burn-rate** alerts (`docs/SLO.md`, `k8s/monitoring/prometheus-slo-rules.yaml`). |

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
| Automated tests (unit/integration) | ✅ | `node:test` suite (49): pure helpers, card structure, loop/circuit-breaker logic, **DB-repository integration** tests, command registry, the **SGNS recommender** (learns cluster structure), and **shard-range** maths. CI **coverage gate** (~75% lines). **Remaining:** broader command-handler tests. |
| Load / soak testing | ✅ | k6 harnesses (`load/`) for the public API with SLO-mirroring thresholds + a long soak; HPA-validation guidance in `load/README.md`. |
| Continuous **Deployment** (CD) | ✅ | `release.yml` builds + pushes to GHCR on `v*` tags; **canary→full** via the StatefulSet `RollingUpdate` partition (`docs/SCALING_SHARDING.md`). |

### 8. Security

| Capability | Status | Evidence / gap |
|---|---|---|
| Secrets hygiene | ✅ | Credentials only in gitignored `.env` / K8s `Secret`; `.example` templates tracked; least-privilege gateway intents. |
| Non-root container, minimal image | ✅ | Runs as `node` user on a slim base (`Dockerfile`). |
| Secret management & rotation | ✅ | External Secrets Operator manifest (`k8s/external-secrets.yaml`) syncs `elfaria-secrets` from an external manager on a `refreshInterval` (+ Reloader to roll pods), so rotation propagates automatically. |
| Network policies / RBAC / image scanning | ✅ | Trivy image scan in CI, `k8s/network-policy.yaml` default-deny, pod `securityContext` (non-root, dropped caps, seccomp). |

### 9. Data science & ML

| Capability | Status | Evidence / gap |
|---|---|---|
| Recommendation / autoplay | ✅ | **Trained item2vec/SGNS** embeddings (`src/ml/`, `npm run train`) served on boot and queried first by autoplay, then a co-play **collaborative filter** (`analytics/recommend.ts`), then a YouTube-mix fallback. Plus an autoplay **buffer** + **/reroll**. |
| Event/analytics pipeline | ✅ | Structured play/skip/search events to the DB, optionally published to **Kafka** (`analytics/events.ts`). Powers the recommender + public stats API. |
| Experimentation (A/B) | ✅ | `analytics/experiments.ts` — deterministic hash-bucketed variants + `exposure` events; a live experiment (recommender ordering) runs in autoplay. Analysis query in `docs/DATA.md`. |
| Event/analytics pipeline | ✅ | Structured events → DB (+ optional Kafka), `analytics/events.ts`. |
| Recommendation (learned) | ✅ | item2vec/SGNS model trained offline on listening sessions (`scripts/train-recommender.ts`), loaded for inference and used ahead of the co-play CF. Tests prove it learns genre clusters. |
| Capacity forecasting / anomaly detection | 🟡 | `predict_linear` forecast on active players (advisory "scale-up soon" / KEDA input) + anomaly alerts (sudden player drop, z-score command-rate) in `k8s/monitoring/prometheus-forecast-rules.yaml`. Reactive HPA still does the actual scaling; wiring the forecast to autoscale is the next step. |

---

## The data-science angle, concretely

Where a Netflix-style data practice plugs into Elfaria. **All four are now
built**: 1–2 (trained recommender + event pipeline), and 3–4 below (predictive
scaling + anomaly detection in `k8s/monitoring/prometheus-forecast-rules.yaml`).
Plus an **A/B framework** (`analytics/experiments.ts`) on top of the pipeline:

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
hardening, ✅ a public stats API, ✅ GDPR `/forget-me` + retention. And the five
items that were called out here as "what remains" are now done too:

1. ✅ **Trained recommender** — item2vec/SGNS embeddings trained offline on
   listening sessions and served for inference, queried first by autoplay
   (`src/ml/`, `npm run train`).
2. ✅ **SLIs/SLOs + error budgets** with multi-window burn-rate alerts
   (`docs/SLO.md`).
3. ✅ **Multi-pod bot sharding** (coordinated shard ranges) + **canary** rollouts
   via the StatefulSet partition (`docs/SCALING_SHARDING.md`).
4. ✅ **Postgres HA + read replicas** (`k8s/postgres-ha.yaml`, `DATABASE_REPLICA_URL`);
   multi-region pattern documented in `docs/DATA.md`.
5. ✅ **Automated secret rotation** (External Secrets) + **load/soak testing**
   (k6, `load/`).

What's genuinely left is narrow: cross-pod presence aggregation, a black-box
playback canary, broader command-handler tests, and true multi-region failover
orchestration (warranted only at much larger scale). The honest headline: Elfaria
is now **built like a scalable system and operated like one too**. Progress is
tracked in [ROADMAP.md](./ROADMAP.md); the data architecture is in
[DATA.md](./DATA.md).

> Scope caveat: this is a design-level comparison. The scaling features are
> verified to *function* (see README "Verifying the scale-out features"); they
> have not been load-tested at scale, and the Kubernetes manifests have not been
> applied to a live cluster.
