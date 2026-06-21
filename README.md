# Elfaria 🎵

A Discord **music bot** built with **discord.js v14** and **discord-player**, in
TypeScript. This is the single-process **v1** described in the architecture doc —
a long-lived, stateful, event-driven service that connects to Discord over a
WebSocket, streams encrypted audio over voice, and persists durable state in an
embedded SQLite database.

## Features

- **Slash commands** with autocomplete on `/play`.
- **Playback**: play / skip / stop / pause / resume, queue view, now-playing
  with a progress bar, volume, repeat (off/track/queue/autoplay), shuffle,
  remove-by-position.
- **Multi-source** via discord-player extractors (SoundCloud, YouTube\*, Spotify/
  Apple bridging, direct links). \*YouTube extraction is loaded best-effort and
  isolated so it can be updated independently when it breaks.
- **Persistence (SQLite)**: per-guild default volume, DJ role, and **saved
  playlists** (`/playlist save|load|list|delete`) that survive restarts.
- **Hardening**: per-user command cooldowns, DJ permission gate, structured
  (pino) logging, global error handlers, auto-leave on empty channel / queue
  end, and graceful shutdown.
- **Ops**: Docker + docker-compose, GitHub Actions CI (lint → typecheck → docker
  build), `.env`-based secrets.

## Commands

| Command                              | Description                                      |
| ------------------------------------ | ------------------------------------------------ |
| `/ping`                              | Liveness + gateway latency.                      |
| `/play <query>`                      | Play a song or playlist (search text or URL).    |
| `/skip`                              | Skip the current track.                          |
| `/stop`                              | Stop, clear the queue, leave the channel.        |
| `/pause`, `/resume`                  | Pause / resume playback.                         |
| `/queue [page]`                      | Show the queue.                                  |
| `/nowplaying`                        | Current track + progress bar.                    |
| `/volume [level]`                    | Show or set volume (0–100); persisted per guild. |
| `/loop <mode>`                       | off / track / queue / autoplay.                  |
| `/shuffle`                           | Shuffle upcoming tracks.                         |
| `/remove <position>`                 | Remove a track by its queue position.            |
| `/settings view\|dj-role`            | View settings / set the DJ role (Manage Server). |
| `/playlist save\|load\|list\|delete` | Manage saved playlists.                          |

Playback-control commands respect the **DJ role** if one is configured
(`/settings dj-role`); otherwise everyone can use them. Members with **Manage
Server** always count as DJs.

## Quick start

Requires **Node.js 22+** and a Discord application/bot token.

```bash
# 1. Install (builds native deps: mediaplex, better-sqlite3)
npm install

# 2. Configure secrets
cp .env.example .env
#   then fill in DISCORD_TOKEN and DISCORD_CLIENT_ID (and DISCORD_GUILD_ID
#   for instant command registration while developing).

# 3. Register slash commands (run again whenever command definitions change)
npm run deploy

# 4. Run
npm run dev      # watch mode
# or
npm start
```

Invite the bot with the `bot` and `applications.commands` scopes and the
permissions: **Connect**, **Speak**, **Send Messages**, **Embed Links**.

### Environment variables

See [`.env.example`](./.env.example). Required: `DISCORD_TOKEN`,
`DISCORD_CLIENT_ID`. Optional: `DISCORD_GUILD_ID` (instant/staging command
registration), `DATABASE_PATH`, `LOG_LEVEL`, `DEFAULT_VOLUME`,
`LEAVE_ON_EMPTY_COOLDOWN_MS`, `LEAVE_ON_END_COOLDOWN_MS`, `DEFAULT_COOLDOWN_MS`.

> **Secrets:** the bot token is a full credential. It lives only in `.env`,
> which is gitignored — never commit it.

## Scripts

| Script              | Purpose                               |
| ------------------- | ------------------------------------- |
| `npm run dev`       | Run with file-watch (tsx).            |
| `npm start`         | Run once (tsx).                       |
| `npm run deploy`    | Register slash commands with Discord. |
| `npm run typecheck` | `tsc --noEmit`.                       |
| `npm run lint`      | ESLint.                               |
| `npm run format`    | Prettier.                             |

## Docker

```bash
cp .env.example .env   # fill it in
docker compose up --build -d
```

The SQLite database persists in the `elfaria-data` named volume. The bot exposes
no ports — it dials out to Discord and serves no HTTP.

## Project structure

```
src/
├─ index.ts                # entry: boot, error handlers, graceful shutdown
├─ client.ts               # Client + intents + command/cooldown collections
├─ config.ts               # validated env config
├─ commands/               # one file per slash command + index registry
├─ events/                 # ready, interactionCreate (router), voiceStateUpdate
├─ music/
│  ├─ player.ts            # discord-player init, extractors, event wiring
│  ├─ sources.ts           # swappable resolve(query) sourcing interface
│  └─ QueueManager.ts      # typed queue helpers + node options
├─ db/                     # SQLite connection, guild settings, playlists
├─ cache/                  # in-memory TTL cache
└─ lib/                    # logger, types, interaction helpers
deploy-commands.ts         # REST slash-command registration
Dockerfile, docker-compose.yml
.github/workflows/ci.yml
```

## How it maps to the architecture doc

- **§1 Gateway / WebSockets** — `client.ts` (least-privilege intents: `Guilds`,
  `GuildVoiceStates`), `events/`.
- **§2 Command layer** — `commands/`, `events/interactionCreate.ts` (router +
  3-second-ack pattern via `deferReply`), `deploy-commands.ts`.
- **§3 Voice (encrypted UDP/Opus)** — `music/player.ts` via discord-player
  (its `discord-voip` + `mediaplex`/Opus stack; in-process, Option A).
- **§4 Sourcing pipeline** — `music/sources.ts`, isolated behind `resolve()`.
- **§5 Queue & state** — `music/QueueManager.ts`.
- **§6 Persistence** — `db/` (SQLite via better-sqlite3).
- **§7 Caching** — `cache/` (TTL Map for searches + guild settings).
- **§8 Rate limiting** — `@discordjs/rest` (built into discord.js) + per-user
  cooldowns in the router.
- **§10 Reliability** — error handlers + graceful shutdown in `index.ts`,
  pino logging in `lib/logger.ts`, auto-leave in `events/voiceStateUpdate.ts`.
- **§11 Deployment** — `Dockerfile`, `docker-compose.yml`, CI, `.env` secrets.

## Scaling beyond v1 (deliberately not built)

Per the doc, these arrive only when real scale forces them:

- **Audio offload → Lavalink** (doc §3 Option B): swap `music/player.ts` for a
  Lavalink client; `docker-compose.yml` has commented stubs.
- **Database → Postgres**, **cache → Redis** (doc §6–§7): the `db/` and `cache/`
  modules expose small interfaces precisely so these swaps stay local.
- **Sharding** (doc §9): wrap with discord.js `ShardingManager` once near ~2,500
  guilds.

## License

MIT
