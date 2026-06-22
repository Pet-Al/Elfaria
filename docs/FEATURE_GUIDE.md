# Elfaria — Feature Guide

## Why this is a flagship audio bot, not an outdated one

Most "music bot" code you'll find is a single Node script that pipes
`ytdl-core`/`youtube-dl` straight into `@discordjs/voice`. That design defined
the 2018–2021 era and is now actively dying for three concrete, verifiable
reasons:

1. **YouTube broke in-process extraction.** Anonymous stream-signature decoding
   fails constantly; bots built on it go silent for days at a time.
2. **Discord shipped DAVE** — a new **end-to-end-encrypted voice protocol**.
   Voice libraries that don't implement it can no longer reliably establish a
   voice connection at all.
3. **Discord deprecated message-content bots.** Reading `!play` from chat now
   requires the *privileged* Message Content intent and verification; the
   ecosystem has moved to slash commands and interactions.

Elfaria is built on the other side of all three lines. This guide explains each
capability, **why it matters**, and **where a legacy bot fails** — followed by
the architecture that makes it extensible and the capabilities you can light up
next almost for free.

---

## Legacy vs. Elfaria at a glance

| Concern | Typical outdated bot | **Elfaria** |
|---|---|---|
| Audio engine | In-process `ytdl-core` / `discord-player` | **Lavalink** (dedicated audio service) |
| YouTube breakage | Edit + redeploy the whole bot, hope it works | Bump one plugin version, restart **only** Lavalink |
| Voice encryption | Old modes / no DAVE → fails to connect | **DAVE E2EE** supported (`@snazzah/davey`) |
| Commands | `!play` prefix (privileged Message Content intent) | **Slash commands** + interactions, least-privilege intents |
| Language | Untyped JavaScript | **Strict TypeScript**, typed end-to-end |
| discord.js | Often v12/v13 (EOL) | **v14** (current) |
| CPU model | Transcodes audio inside the bot process | Bot does **zero** audio work; Lavalink transcodes |
| One bad track | Often crashes the whole process | Logged, surfaced to the user, bot keeps running |
| Crash recovery | Manual restart | Supervised restart + graceful shutdown + node auto-reconnect |
| State | Lost on restart (in-memory only) | **SQLite**: settings + saved playlists persist |
| Deploy | "Works on my machine" script | **Docker Compose** (bot + Lavalink) + CI |
| Secrets | Token hardcoded / committed | `.env` (gitignored), password-protected node |
| Observability | `console.log` | **Structured JSON logs** (pino) with context |
| Scaling | Single process, hard ceiling | Multi-node Lavalink, sharding, Redis — designed-in path |

---

## The dividing line: offloaded audio (Lavalink)

This is the single most important architectural decision and the clearest
modern/legacy marker.

**Legacy (in-process):** the bot resolves the track, downloads/decodes it with
`ytdl-core`, runs FFmpeg, and streams Opus — all inside the Node process. Every
playing guild burns CPU and memory in your bot. YouTube's anti-bot changes break
the extractor, and a single malformed stream can take the whole process down.

**Elfaria (offloaded):** a separate **Lavalink** service does *all* the audio —
sourcing, transcoding, encryption, and the UDP media stream. The bot only:

- forwards Discord's voice state/server updates to Lavalink (the voice bridge),
- sends small commands ("play this", "skip", "set volume") over a WebSocket/REST
  link, and
- reacts to events ("track started", "queue ended").

**Why it matters**

- **Reliability:** YouTube extraction lives in a maintained plugin. When it
  breaks, you bump `youtube-plugin` in `lavalink/application.yml` and restart
  *only* Lavalink — the bot is never rebuilt or redeployed. (This is the exact
  fix path that's already documented in the README, and Lavalink logs when a new
  plugin version is available.)
- **Performance:** your bot's CPU/memory stays flat regardless of how many
  guilds are playing — audio cost is borne by Lavalink and scales independently.
- **Reach:** Lavalink + plugins cover YouTube, SoundCloud, Bandcamp, Twitch,
  Vimeo, HTTP/direct streams, and (via the LavaSrc plugin) Spotify/Apple
  Music/Deezer metadata — far more than a single in-process extractor.

This is the same architecture large public music bots run. It's the reason
Elfaria is built to *stay* working rather than rot.

---

## DAVE — Discord's end-to-end-encrypted voice

Discord rolled out **DAVE** (Discord Audio & Video End-to-End Encryption) across
2024–2025. Newer voice stacks negotiate it the moment they open the voice
socket. Voice libraries that lack DAVE support increasingly **cannot establish a
voice connection** — which is why many old bots simply stopped being able to
join channels.

Elfaria's audio path supports DAVE: Lavalink's voice layer loads the native
`dave-jvm` library, and on the bot side the dependency is present so the
handshake completes. **Where a legacy bot throws "DAVE protocol support
requires…" and dies, Elfaria connects.** This is a hard, binary modern-vs-
outdated test, and Elfaria is on the right side of it.

---

## Slash commands & interactions (not prefix commands)

Elfaria is **slash-command only**:

- **Least-privilege intents.** It requests only `Guilds` and `GuildVoiceStates`
  — *not* the privileged Message Content intent that prefix (`!play`) bots
  require and that Discord gates behind verification at scale.
- **The 3-second ack pattern.** Long operations (search, connect) `deferReply()`
  immediately, then edit the response — so commands never show as "failed" while
  work happens. This is the correctness contract modern Discord enforces.
- **Native UX.** Argument validation, choices (e.g. `/loop off|track|queue`),
  permission-gated commands (`/settings` requires Manage Server), and ephemeral
  error replies are all first-class.
- **Typeahead autocomplete on `/play`.** As you type, the bot queries Lavalink
  live and shows a dropdown of real matches; picking one passes the exact track
  URL so playback resolves instantly. It searches via a Lavalink node directly —
  no voice connection required just to suggest — and fails soft to no
  suggestions if the backend hiccups.

**Why it matters:** prefix bots are on borrowed time and leak a privileged
intent. Slash commands are discoverable, validated by Discord, and the only
forward-compatible choice.

### Command surface

| Command | What it does |
|---|---|
| `/play <query>` | Play a track/playlist from search text or a URL. |
| `/skip` | Skip the current track (ends cleanly if it's the last one). |
| `/stop` | Stop, clear the queue, and leave the channel. |
| `/pause`, `/resume` | Pause / resume playback. |
| `/queue [page]` | Paginated queue view with durations + repeat mode. |
| `/nowplaying` | Current track with a live progress bar. |
| `/volume [level]` | Show or set volume; the level **persists** per guild. |
| `/loop <mode>` | Repeat off / track / queue. |
| `/shuffle` | Shuffle the upcoming tracks. |
| `/remove <position>` | Remove a queued track by position. |
| `/settings view\|dj-role` | View settings / set the DJ role (Manage Server). |
| `/playlist save\|load\|list\|delete` | Save the queue and reload it later. |

**DJ gate:** playback-control commands respect a configurable DJ role; with none
set, everyone can use them, and Manage-Server members always count as DJs.

---

## Persistence that survives restarts

Outdated bots keep everything in memory, so a redeploy wipes every server's
settings. Elfaria uses an **embedded SQLite database** (`better-sqlite3`) with
prepared statements and a small typed repository layer:

- **Per-guild settings** — default volume and DJ role.
- **Saved playlists** — `/playlist save` snapshots the current queue under a
  name; `/playlist load` re-resolves and plays it later. These persist across
  restarts and redeploys.
- **A TTL cache** in front of settings keeps hot paths off the database.

No external database server to run for v1 — the file lives in a Docker volume —
yet the data layer is abstracted behind small interfaces so moving to Postgres
later is a localized change.

---

## Reliability & operations (24/7-grade)

A flagship bot is one you can leave running. Elfaria is built for that:

- **A bad track never kills the bot.** Track errors are caught, logged with
  guild/track context, and reported to the channel; playback continues. (Proven
  in testing: when the audio backend was down, `/play` returned a clean error
  instead of crashing.)
- **Global safety nets.** `unhandledRejection` is logged (not fatal);
  `uncaughtException` logs and exits so the supervisor restarts a clean process.
- **Graceful shutdown.** On `SIGINT`/`SIGTERM` it destroys players (leaving voice
  cleanly), closes the database (WAL checkpoint), and disconnects.
- **Node auto-reconnect.** The Lavalink connection retries with backoff and
  tolerates Lavalink's slower first boot, so transient outages self-heal.
- **Auto-leave.** Leaves on an empty channel (cancellable timer) and after the
  queue ends — freeing voice resources and saving cost.
- **Rate-limit respect.** discord.js's REST layer honors Discord's buckets, and
  per-user command cooldowns stop one user from flooding the bot or source APIs.
- **Structured logging.** pino emits queryable JSON with levels and context —
  not `console.log` strings — so you can actually operate it.

---

## Security & secret hygiene

- The **bot token** and **Lavalink password** live only in `.env`, which is
  gitignored — never committed, never baked into the image.
- Lavalink is **not published to the host**; it's reachable only by the bot on a
  private Docker network and is **password-authenticated**.
- All Discord API traffic is TLS; voice media is encrypted (DAVE, §above).
- The container runs the bot as a **non-root** user.

---

## Architecture & extensibility

The codebase is organized around clean, swappable seams (TypeScript throughout):

```
src/
├─ client.ts        # gateway client + LavalinkManager + command/cooldown maps
├─ config.ts        # validated env config (fails fast on misconfig)
├─ commands/        # one file per command + an explicit registry
├─ events/          # ready (inits Lavalink), interactionCreate (router), voiceStateUpdate
├─ music/
│  ├─ player.ts     # Lavalink event wiring + raw voice forwarding
│  ├─ sources.ts    # the single resolve(query) interface — swap sourcing here
│  └─ QueueManager.ts # typed player/queue helpers
├─ db/              # SQLite + per-guild settings + playlists (typed repos)
├─ cache/           # in-memory TTL cache (Redis-shaped interface)
└─ lib/             # logger, types, interaction helpers
```

- **Add a command:** drop a `{ data, execute }` file in `commands/` and import it
  in the registry. The router handles cooldowns and error reporting for free.
- **Add/replace a source:** everything funnels through `resolve()` in
  `sources.ts` — sourcing is isolated from command logic.
- **Swap storage/cache:** `db/` and `cache/` expose small interfaces, so moving
  to Postgres or Redis is local and low-risk.

---

## Lavalink superpowers

Because audio runs on Lavalink, a whole class of "premium" features is cheap —
they're platform capabilities, not rewrites. Several now ship:

- **Audio filters / DSP** ✅ `/filter` — equalizer presets, bass boost,
  nightcore, vaporwave, 8D, karaoke, lowpass, via `lavalink-client`'s filter
  manager (the DSP runs on Lavalink, not the bot).
- **Autoplay / radio** ✅ `/autoplay` — continues with related tracks when the
  queue ends (`onEmptyQueue.autoPlayFunction`).
- **Now-playing buttons** ✅ — a control panel (⏯️ ⏭️ ⏹️ 🔀 📜) on every
  now-playing message, sharing the commands' voice/DJ guards.
- **More sources via plugins:** **LavaSrc** (Spotify / Apple Music / Deezer) is
  bundled; **SponsorBlock** and **lyrics** plugins are a config addition away —
  no bot rewrite.

---

## Scaling path (built in, config-activated)

These are implemented and switched on by configuration — defaults keep the bot a
single process, so nothing changes until you opt in (see the README "Scaling").

- **More Lavalink nodes:** set `LAVALINK_NODES` (JSON); lavalink-client balances
  sessions across them. Audio scales independently of the bot.
- **Sharding:** `SHARDING=on` + `npm run start:sharded` launches one bot process
  per shard via `ShardingManager` (`src/shard.ts`); discord.js injects shard
  id/count, so command/voice code is unchanged.
- **Shared cache → Redis:** set `REDIS_URL` and the search cache moves to Redis,
  shared across all shards/processes; empty = in-memory.
- **Database → Postgres:** set `DATABASE_URL` and the same dialect-agnostic
  queries run on Postgres via an async driver; empty = embedded SQLite (default).

---

## Honest limitations & roadmap

Flagship doesn't mean finished. The default runtime is a single-process bot +
one Lavalink node — the right size for one-to-many servers — but the scale-out
paths (multi-node, Redis, sharding) are built in and config-activated. Still
deferred (all straightforward on this foundation):

- Spotify/Apple/Deezer ship via the bundled LavaSrc plugin; Spotify just needs
  free API credentials (see the README's "Enabling Spotify").
- Lyrics and SponsorBlock are available as Lavalink plugins (not yet wired).

The reason these are *easy* additions rather than rewrites is the whole point of
the architecture: the hard, future-proofing decisions — offloaded audio, DAVE,
slash commands, TypeScript, containerization, resilience — are already made.

---

## TL;DR

Elfaria is "flagship, not outdated" because it sits on the modern side of the
three changes that broke the old generation of music bots: **audio is offloaded
to Lavalink** (so YouTube breakage is a one-line plugin bump, not a dead bot),
**DAVE voice encryption works** (so it can actually join voice), and it's
**slash-command, strict-TypeScript, containerized, and resilient** (so it's
operable 24/7 and cheap to extend). The legacy approach it deliberately avoids is
exactly the approach that no longer works.
