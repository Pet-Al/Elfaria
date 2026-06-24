# Elfaria reference

The complete reference for Elfaria — every command, module, config value, data
store, metric, and HTTP endpoint. Reference-style (like the discord.js / Discord
API docs): organized by area, each symbol with its purpose and shape. New here?
Start with the **[user & operator guide](./GUIDE.md)**; for the *why*, see
**[ARCHITECTURE_COMPARISON.md](./ARCHITECTURE_COMPARISON.md)** and
**[DATA.md](./DATA.md)**.

- [Slash commands](#slash-commands)
- [Now-playing components](#now-playing-components)
- [Source tree & modules](#source-tree--modules)
- [Configuration (env vars)](#configuration-env-vars)
- [Data model](#data-model)
- [HTTP API & dashboard](#http-api--dashboard)
- [Metrics](#metrics)
- [Scripts](#scripts)

---

## Slash commands

All commands are guild-only and ack within Discord's 3s window. DJ-gated
commands require the configured DJ role (or Manage Server / Admin); if no DJ role
is set, everyone may use them. Voice-gated commands require you to be in the
bot's voice channel.

### Playback

| Command | Options | Gate | Description |
|---------|---------|------|-------------|
| `/play` | `query` (autocomplete) | voice | Play/queue a track, playlist, or search. |
| `/pause` `/resume` | — | voice+DJ | Pause / resume. |
| `/skip` | — | voice+DJ | Skip current (advances via autoplay if the queue is empty). |
| `/skipto` | `position` | voice+DJ | Skip to a queue position. |
| `/seek` | `time` | voice+DJ | Seek within the current track. |
| `/stop` | — | voice+DJ | Stop, clear the queue, leave. |
| `/nowplaying` | — | — | Snapshot of the now-playing card. |
| `/lyrics` | — | — | Lyrics for the current track (LRCLIB). |
| `/replay` | `[position]` | voice | Replay a history entry (default: most recent). |

### Queue

| Command | Options | Gate | Description |
|---------|---------|------|-------------|
| `/queue` | `[page]` | — | Paginated queue (Prev/Next + jump dropdown). |
| `/clear` | — | voice+DJ | Empty the upcoming queue. |
| `/move` | `from` `to` | voice+DJ | Move a track within the queue. |
| `/remove` | `position` | voice+DJ | Remove a track. |
| `/shuffle` | — | voice+DJ | Shuffle the queue. |
| `/loop` | (dropdown on the card) | voice+DJ | Off / track / queue (× once / infinite). |
| `/autoplay` | `[when-off: dequeue\|keep]` | voice+DJ | Toggle related-track autoplay; buffers ahead. |
| `/recommend` | `[count]` | voice+DJ | Queue picks for you (trained model + co-play + your taste). |
| `/reroll` | — | voice+DJ | Replace autoplay picks with a fresh shuffle. |
| `/autoplay-dequeue` | — | voice+DJ | Remove autoplay picks (keeps your own). |

### Modes & sound

| Command | Options | Gate | Description |
|---------|---------|------|-------------|
| `/lofi` | `[theme] [shuffle]` | voice+DJ | Play a lofi **theme** (chill/study/sleep/jazz/chillhop/synthwave/rainy); enables autoplay for endless play — no forced loop. |
| `/24-7` | `[mode: until-empty\|forever\|off]` | voice+DJ | Stay in voice; auto-rejoins on restart. |
| `/filter` | `type`, `[save]` | voice+DJ | EQ/effects (incl. `vocal`); `save:true` = server default. |
| `/sponsorblock` | `[mode: on\|off]` | voice+DJ | Skip sponsor/intro/outro/off-topic segments (persisted per guild). |
| `/volume` | `level` | voice+DJ | Set volume (persisted per guild). |

### Library, server & meta

| Command | Options | Gate | Description |
|---------|---------|------|-------------|
| `/favorites` | `list` / `play` | — | Your ⭐ saved tracks. |
| `/history` | — | — | Paginated per-server play history. |
| `/playlist` | save/list/load/delete | — | Per-user named playlists (name **autocomplete** on load/delete). |
| `/summon` | — | voice | Move the bot to your channel. |
| `/settings` | DJ role, default volume | Manage Server | Per-guild settings. |
| `/status` | — | — | Live health (servers/players/nodes/uptime). |
| `/about` | — | — | The tech stack / architecture brief. |
| `/help` | — | — | Grouped command reference. |
| `/ping` | — | — | Liveness + gateway latency. |

### Privacy & owner

| Command | Options | Gate | Description |
|---------|---------|------|-------------|
| `/forget-me` | — | — | GDPR erasure of your data (can be owner-disabled). |
| `/admin retention` | `on\|off` | **owner** | Toggle the 90-day data deletion. |
| `/admin forget-me` | `on\|off` | **owner** | Toggle user access to `/forget-me`. |
| `/admin status` | — | **owner** | Show the owner toggles. |

---

## Now-playing components

Custom-id prefixes routed in `events/interactionCreate.ts` (all instrumented via
`instrumentComponent`):

- **`np:*`** (`events/buttons.ts`) — `back`, `playpause`, `skip`, `stop`, `queue`,
  `favorite`, `shuffle`, `replay`; select menus `np:loop`, `np:volume`, `np:seek`.
- **`hist:*`** (`events/historyComponents.ts`) — `hist:page:<n>` buttons, `hist:select` jump dropdown.
- **`q:*`** (`events/queueComponents.ts`) — `q:page:<n>` buttons, `q:select` jump dropdown.

The live card has 5 rows: transport · ⭐/🔀 utility · loop · volume · seek. A
retired card (finished, buried, or after the bot leaves) shows greyed transport +
a live **Replay + Favorite** row that expires after ~30 min.

---

## Source tree & modules

```
src/
  index.ts           Entry point: boot order, process error handlers, graceful shutdown
  shard.ts           ShardingManager launcher (single-pod, multi-process)
  client.ts          ElfariaClient: gateway Client + LavalinkManager wiring
  config.ts          Validated config from env (the single source of truth)
  commands/          One file per slash command + index.ts registry
  events/            interactionCreate (router), ready, voiceStateUpdate, buttons,
                     historyComponents, queueComponents, index (self-healing bindEvent)
  music/             player (Lavalink events + the now-playing panel), QueueManager,
                     autoplay, filters, loop, nowPlayingCard, sources, queueStore,
                     panelStore, rejoin
  analytics/         events (pipeline), kafka, recommend (co-play CF), experiments (A/B)
  ml/                sgns (item2vec trainer), dataset, recommender (inference serve)
  db/                driver (SQLite/Postgres), guilds, history, favorites, playlists,
                     appSettings, index
  lib/               metrics, tracing, logger, api, lyrics, circuitBreaker, artwork,
                     interactions, commandSync, clusterCount, playbackProbe, playCanary,
                     shardRange, types
  cache/             search cache (memory or Redis)
```

### Key modules

- **`client.ts`** — constructs the `LavalinkManager` (nodes, `autoSkip`,
  `onEmptyQueue.autoPlayFunction`, `maxErrorsPerTime`, `queueOptions.queueStore`)
  and applies the multi-pod shard assignment.
- **`music/player.ts`** — wires Lavalink events; owns the single per-guild
  now-playing panel (`placePanel`, `greyPanel`, `refreshPanel`); fetches synced
  lyrics; arms 24/7, pause, and progress timers; persists/expires panels.
- **`music/QueueManager.ts`** — `ensurePlayer` / `getOrCreatePlayer` (applies
  persisted volume, autoplay, and saved filter), `skipCurrent`, `formatDuration`,
  `parseTimestamp`, and the `autoplayKey` / `filterKey` helpers.
- **`music/autoplay.ts`** — `autoPlayFunction` (onEmptyQueue), `fillAutoplayBuffer`,
  `rerollAutoplay`, `clearAutoplayQueued`. Sources: trained model → co-play CF →
  YouTube mix (order A/B-tested via `analytics/experiments`).
- **`music/nowPlayingCard.ts`** — the Components V2 card + row builders
  (`controlRow`, `utilityRow`, `loopSelectRow`, `volumeSelectRow`, `seekSelectRow`,
  `endedRow`) and `progressBar`.
- **`music/queueStore.ts`** / **`music/rejoin.ts`** — DB-backed queue persistence
  and 24/7 auto-rejoin (session migration).
- **`ml/`** — `trainSgns` (skip-gram + negative sampling), `buildSessions`,
  `loadRecommender` / `recommendTracks` / `startRecommenderReload`.
- **`lib/lyrics.ts`** — `fetchLyrics` (found/not-found/error), `fetchSyncedLyrics`,
  `parseLrc`, `currentLine`.
- **`lib/commandSync.ts`** — `reconcileGlobalCommands` (idempotent), `syncCommands`,
  `clearGuildCommands`, `commandsHash`.
- **`lib/playbackProbe.ts`** / **`lib/playCanary.ts`** — resolve probe and
  end-to-end play canary.
- **`lib/clusterCount.ts`** — cross-pod guild count via Redis.

---

## Configuration (env vars)

See **[.env.example](../.env.example)** for the annotated source of truth.

| Area | Vars |
|------|------|
| Discord | `DISCORD_TOKEN`*, `DISCORD_CLIENT_ID`*, `DISCORD_GUILD_ID`, `OWNER_ID` |
| Commands | `AUTO_DEPLOY_COMMANDS`, `CLEAR_ALL_GUILD_COMMANDS`, `DEFAULT_COOLDOWN_MS` |
| Database | `DATABASE_URL`, `DATABASE_PATH`, `DATABASE_REPLICA_URL` |
| Lavalink | `LAVALINK_PASSWORD`, `LAVALINK_HOST/PORT/SECURE`, `LAVALINK_NODES` |
| Music | `DEFAULT_VOLUME`, `DEFAULT_SEARCH_PLATFORM`, `LEAVE_ON_EMPTY/END_COOLDOWN_MS`, `NOWPLAYING_REFRESH_MS`, `AUTOPLAY_QUEUE_SIZE`, `MAX_TRACK_ERRORS`, `MAX_TRACK_ERRORS_WINDOW_MS` |
| Scaling | `REDIS_URL`, `SHARDING`, `SHARD_COUNT`, `TOTAL_SHARDS`, `SHARDS_PER_POD`, `SHARD_IDS`, `POD_NAME` |
| Observability | `METRICS_ENABLED/PORT`, `OTEL_EXPORTER_OTLP_ENDPOINT` |
| Analytics/API | `KAFKA_BROKERS/TOPIC`, `API_ENABLED/PORT`, `DATA_RETENTION_DAYS` |
| ML | `RECOMMENDER_MODEL_PATH` |
| Canary | `CANARY_GUILD_ID`, `CANARY_VOICE_CHANNEL_ID`, `CANARY_TEXT_CHANNEL_ID`, `CANARY_QUERY` |
| Spotify | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` |

\* required.

---

## Data model

Tables and the `app_settings` key/value store are documented in full in
**[DATA.md](./DATA.md)**: `guild_settings`, `playlists`, `playlist_tracks`,
`play_history`, `favorites`, `events` (play/skip/search/exposure), `app_settings`.

`app_settings` keys: `commands_global_hash`, `retention_enabled`,
`forgetme_enabled`, `autoplay:<g>`, `filter:<g>`, `247state:<g>`, `panel:<g>`,
`queue:<g>`.

---

## HTTP API & dashboard

Read-only, aggregate, no PII. Enable with `API_ENABLED=true` on `API_PORT`.

- `GET /` (or `/dashboard`) — auto-refreshing HTML dashboard.
- `GET /api/health` — `{status, uptimeSeconds}`.
- `GET /api/stats` — `{guilds, activePlayers, connectedNodes, uptimeSeconds}`.
- `GET /api/top-tracks` — top 10 by play count (read replica).

---

## Metrics

Prometheus text on `GET /metrics` (`METRICS_PORT`). Highlights:

- `elfaria_commands_total{command,status}`, `elfaria_command_duration_seconds`
- `elfaria_component_interactions_total{kind,status}`
- `elfaria_active_players`, `elfaria_lavalink_nodes_connected`
- `elfaria_search_cache_total{result}`, `elfaria_source_resolve_seconds`
- `elfaria_playback_probe_success` / `_latency_seconds`, `elfaria_play_canary_success`
- `elfaria_recommender_tracks`, `elfaria_recommender_trained_timestamp_seconds`
- recording rules: `elfaria:command_error:ratio_rate*`, `elfaria:active_players:predict_30m`

SLOs, burn-rate alerts, forecast + anomaly rules: **[SLO.md](./SLO.md)** and
`k8s/monitoring/`.

---

## Scripts

| `npm run` | Does |
|-----------|------|
| `dev` / `start` | Run (watch / once) via tsx. |
| `start:sharded` | Run under ShardingManager. |
| `deploy` / `deploy:list` | Register commands GLOBALLY (Elfaria is global-only) / inspect what's registered. `deploy -- --clear-guild <id>` removes an orphaned guild copy. |
| `train` | Train the item2vec recommender → model artifact. |
| `typecheck` / `lint` / `format` | `tsc --noEmit` / ESLint / Prettier. |
| `test` / `test:coverage` | `node:test` suite (+ coverage gate). |
