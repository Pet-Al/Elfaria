# Data architecture — storage, API, Kafka & data usage

Everything Elfaria stores or moves: where it lives, why, how it flows, and how
it's governed. This is the companion to the privacy notice ([../PRIVACY.md](../PRIVACY.md))
and the reliability/scaling docs.

## At a glance — the data tiers

```
   Discord ⇄  ┌──────────────────────────────────────────────┐
   gateway    │                 elfaria bot                    │
              │                                                │
              │  in-memory:  Lavalink players/queues (state)   │
              │              search cache (or Redis)           │
              │              artwork-accent cache              │
              │              trained model (loaded from disk)  │
              └───┬───────────────┬───────────────┬────────────┘
        writes ▼  │        reads  │ (analytics)   │ publish (optional)
            ┌─────┴──────┐   ┌────┴───────┐   ┌───┴─────────┐
            │  Postgres  │   │  Postgres  │   │   Kafka     │
            │  PRIMARY   │──▶│  REPLICA   │   │ elfaria.    │
            │ (DATABASE_ │   │(DATABASE_  │   │  events     │
            │   URL)     │   │ REPLICA_URL)│  └──────┬──────┘
            └────────────┘   └────────────┘         ▼  warehouse / stream proc
              durable state    heavy reads      (your downstream)

   offline:  events ──▶ npm run train ──▶ data/recommender.json (embeddings)
```

| Store | Engine | Holds | Lifetime |
|-------|--------|-------|----------|
| **Relational DB** | SQLite (dev) / Postgres (prod) | settings, playlists, history, favorites, events | durable; events/history pruned at retention |
| **Read replica** | Postgres (optional) | a streaming copy for heavy reads | mirrors primary |
| **Search cache** | in-memory or Redis | resolved search results | TTL'd / process-lifetime |
| **Per-player store** | in-memory (Lavalink) | queue, volume, loop, autoplay state | until the player is destroyed |
| **Kafka topic** | Kafka (optional) | the event stream, for a warehouse | your retention policy |
| **Model artifact** | JSON file on disk | track embeddings + metadata | until retrained |

## 1. Relational database

One async driver interface, two backends — chosen automatically by `DATABASE_URL`
(`src/db/driver.ts`):

- **SQLite** (better-sqlite3) — default, zero-config, for non-Docker `npm start`.
- **Postgres** (pg) — default under docker-compose and in k8s; the scalable store.

Repositories speak dialect-agnostic SQL with `?` placeholders (rewritten to `$n`
for Postgres). Writes and the hot transactional path use the **primary** (`db`);
heavy analytics reads use **`readDb`** (the replica when `DATABASE_REPLICA_URL`
is set, else the primary). HA + multi-region is covered in §7.

### Schema (every table)

| Table | Columns | Written by | Read by |
|-------|---------|-----------|---------|
| `guild_settings` | guild_id (PK), default_volume, dj_role_id, created/updated_at | `/settings`, `/volume` | player creation, DJ checks |
| `playlists` | id, guild_id, owner_id, name, created_at — UNIQUE(guild,owner,name) | `/playlist` | `/playlist` list/load |
| `playlist_tracks` | id, playlist_id→playlists, title, url, duration, position, added_at | `/playlist add` | `/playlist load` |
| `play_history` | id, guild_id, title, uri, author, requester_id, played_at | `trackStart` | `/history`, `/replay`, Replay button |
| `favorites` | id, user_id, title, uri, author, created_at — UNIQUE(user,uri) | ⭐ button, `/favorites` | `/favorites` |
| `events` | id, guild_id, user_id, event_type, title, uri, author, query, created_at | `recordEvent()` (play/skip/search) | co-play recommender, public API, trainer |
| `app_settings` | key (PK), value, updated_at | `setAppSetting()` | toggles + bookkeeping (below) |

Indexes back every hot query: `playlist_tracks(playlist_id,position)`,
`play_history(guild_id, played_at DESC, id DESC)`, `favorites(user_id, created_at DESC)`,
and `events(guild_id, created_at)` + `events(event_type, created_at DESC)`.

### `app_settings` keys (global + per-guild key/value)

A small key/value table for things that don't warrant their own schema. Per-guild
keys are suffixed with the guild id. None of it is personal data.

| Key | Meaning |
|-----|---------|
| `commands_global_hash` | hash of the deployed command set — skips re-PUTs when unchanged (dupe/propagation fix) |
| `retention_enabled` | owner toggle: `false` disables the 90-day prune (`/admin retention`) |
| `forgetme_enabled` | owner toggle: `false` disables `/forget-me` (`/admin forget-me`) |
| `autoplay:<guildId>` | persisted autoplay default, re-applied on player creation |
| `filter:<guildId>` | persisted server-wide filter (`/filter-save`), re-applied on player creation |
| `247state:<guildId>` | JSON `{v,t,forever,lofi?}` — voice/text channel + mode (+ lofi station) for **24/7 auto-rejoin on restart** |
| `panel:<guildId>` | live now-playing message ref, used to retire a panel left by a crashed process |
| `queue:<guildId>` | serialized queue (current + upcoming + previous) — **queue persistence / session migration**, restored on 24/7 rejoin |

## 2. The event pipeline

`recordEvent()` (`src/analytics/events.ts`) is the single entry point for
analytics. It is **fire-and-forget and fail-soft** — analytics never block or
break playback. Every event does two things:

1. **Always** → an `INSERT` into the `events` table (the always-available sink).
2. **If `KAFKA_BROKERS` is set** → ALSO published to Kafka (`src/analytics/kafka.ts`).

**Event types** (`EventType`): `play`, `skip`, `search`, `exposure`.

| Field | play | skip | search | exposure |
|-------|------|------|--------|----------|
| guildId, userId | ✓ | ✓ | ✓ | ✓ |
| title, uri, author | ✓ | ✓ | — | — |
| query | — | — | ✓ (the search text) | ✓ (`experiment=variant`) |

### A/B experiments

`analytics/experiments.ts` buckets a unit (guild/user) into a variant by hashing
`experiment:unit` (deterministic, no stored assignments) and logs an `exposure`
event. Combined with `skip`/`play` events you can compare outcomes per variant.
Example — skip rate by recommender-ordering variant:

```sql
WITH g AS (   -- guild → its assigned variant (from exposure events)
  SELECT DISTINCT guild_id, substr(query, instr(query,'=')+1) AS variant
  FROM events WHERE event_type='exposure' AND query LIKE 'reco_order=%'
)
SELECT g.variant,
       AVG(CASE WHEN e.event_type='skip' THEN 1.0 ELSE 0 END) AS skip_rate
FROM events e JOIN g ON g.guild_id = e.guild_id
WHERE e.event_type IN ('play','skip')
GROUP BY g.variant;
```

### Kafka

- **Topic**: `KAFKA_TOPIC` (default `elfaria.events`).
- **Key**: the `guildId` (so a guild's events land on one partition, preserving
  per-guild order — which the session-based recommender depends on).
- **Value**: JSON — the `AnalyticsEvent` plus a `ts` (epoch ms) at publish time.
- **Producer**: kafkajs, an **optional dependency**, imported dynamically and
  connected lazily; a deploy without Kafka pays nothing. A broker hiccup is
  swallowed (the DB copy is the source of truth).

Kafka is the bridge to a **warehouse / stream processing** — consume the topic
into BigQuery/Snowflake/ClickHouse/Flink for dashboards, A/B analysis, or
training a bigger model than the built-in one.

## 3. Public stats API

A separate, read-only HTTP server (`src/lib/api.ts`), off by default
(`API_ENABLED=true`, `API_PORT=8080`). It is deliberately **aggregate-only and
PII-free**, so it's safe to expose publicly:

| Endpoint | Returns | Source |
|----------|---------|--------|
| `GET /api/health` | `{status, uptimeSeconds}` | process |
| `GET /api/stats` | `{guilds, activePlayers, connectedNodes, uptimeSeconds}` | live Lavalink/gateway |
| `GET /api/top-tracks` | `{tracks:[{title, uri, author, plays}]}` (top 10) | `events` via **readDb** |

No user ids, no guild ids, no per-guild data leave this surface. Top-tracks is an
aggregate `COUNT(*)` grouped by track — the heaviest read, routed to the replica.

## 4. Trained recommender data

The offline trainer (`npm run train`, `scripts/train-recommender.ts`) reads the
`events` table via `readDb`, builds **listening sessions** (per-guild play runs
split on a 30-min gap), trains item2vec/SGNS embeddings, and writes one artifact:

- **Location**: `RECOMMENDER_MODEL_PATH` (default `data/recommender.json`).
- **Contents**: `{version, dim, trainedAt, count, vectors:{uri→number[]}, meta:{uri→{title,author}}}`.
  Vectors are rounded to 5 dp for compactness. **No user ids** — it's track-level
  only, so it carries no personal data.
- **Lifetime**: loaded into memory on boot; replaced when you retrain (run it on
  a schedule to keep fresh). Absent = the bot falls back to heuristics.

## 5. Caches & ephemeral data (not durable)

- **Search cache** — resolved search results, keyed by query. In-memory per
  process by default; set `REDIS_URL` to share it across shards/pods. TTL'd.
- **Per-player store** — Lavalink holds the authoritative queue + our state keys
  on the player object (`autoplay`, `autoplaySeen`, `autoplayQueued`, the
  now-playing message handle, timers). All in memory; gone when the player is
  destroyed (bot leaves / stops). Volume/loop here are session-only; the
  persistent default lives in `guild_settings`.
- **Artwork-accent cache** — extracted accent colours, capped (≈500 entries).

None of these survive a restart; they're rebuilt on demand.

## 6. Data flows

**Playing a track** (the central flow):

```
/play ─▶ resolve (Lavalink, cached) ─▶ enqueue ─▶ trackStart event:
            ├─ recordPlay()  ─▶ play_history (durable, requester_id)
            └─ recordEvent({type:'play'}) ─▶ events table  ─┬─▶ co-play CF / training
                                                            └─▶ Kafka (if enabled)
```

**Autoplay pick** (queue runs dry, autoplay on): trained recommender
(`recommendTracks`, reads the in-memory model) → co-play CF (`coPlayedAfter`,
reads `events` via replica) → YouTube-mix heuristic. `/reroll` replaces the
autoplay-queued tracks with a fresh shuffle.

**Search** → `recordEvent({type:'search', query})`. **Skip** →
`recordEvent({type:'skip'})`.

## 7. HA, replicas & multi-region

- **Single instance** (`k8s/postgres.yaml`) — fine for one region / modest scale.
- **HA cluster** (`k8s/postgres-ha.yaml`, CloudNativePG) — 1 primary + 2 replicas
  with automatic failover. Its services map straight onto our split:
  `-rw` (primary) → `DATABASE_URL`, `-ro` (replicas) → `DATABASE_REPLICA_URL`.
- **Read scaling** — point `DATABASE_REPLICA_URL` at the replica endpoint; the
  app already routes analytics reads there (§1). Consistency note: replicas lag
  slightly, which is fine for aggregates/recommendations but is why the
  transactional path stays on the primary.
- **Multi-region** — run the primary in one region and a read replica per
  additional region (managed cross-region replicas, or a CNPG replica cluster).
  Reads are served locally (low latency); writes go to the primary region. A
  regional outage is handled by promoting a replica (managed failover) and
  repointing `DATABASE_URL`. Kafka, if used, is typically regional with
  cross-region mirroring downstream.

## 8. PII & governance

| Data | Personal? | Where | Erased by |
|------|-----------|-------|-----------|
| `favorites.user_id` | yes (user id) | DB | `/forget-me` → delete |
| `events.user_id` | yes | DB + Kafka | `/forget-me` → delete (DB); Kafka via retention |
| `play_history.requester_id` | yes | DB | `/forget-me` → set NULL (keeps the play for aggregates) |
| guild ids, track titles/uris | not personal | DB/API/Kafka/model | retention prune |
| model embeddings | not personal (track-level) | disk | retrain |

- **Retention** — `pruneOldData(DATA_RETENTION_DAYS)` (default 90) deletes
  `events` and `play_history` older than the cutoff, on boot and daily.
- **Right to erasure** — `/forget-me` runs `forgetUser()`: deletes the user's
  favorites and events, and nulls their `requester_id` in history.
- **Minimisation** — no message content is collected (the bot doesn't request
  that intent); the public API exposes only aggregates.
- **Kafka caveat** — events published to Kafka live by the *topic's* retention,
  not the DB's; honour erasure/retention in your downstream consumer too.

## 9. Configuration quick-reference

| Env | Controls |
|-----|----------|
| `DATABASE_URL` | primary store (empty → SQLite) |
| `DATABASE_REPLICA_URL` | read replica for analytics reads |
| `REDIS_URL` | shared search cache across shards/pods |
| `KAFKA_BROKERS` / `KAFKA_TOPIC` | event publishing |
| `API_ENABLED` / `API_PORT` | public stats API |
| `DATA_RETENTION_DAYS` | events/history prune window |
| `RECOMMENDER_MODEL_PATH` | trained-model artifact location |
