# Elfaria 🎵

A Discord **music bot** built with **discord.js v14** and **Lavalink** (via
`lavalink-client`), in TypeScript. A long-lived, stateful, event-driven service
that connects to Discord over a WebSocket, **offloads audio to a Lavalink node**
(doc §3 Option B), and persists durable state in an embedded SQLite database.

Audio (sourcing, transcoding, encryption, UDP streaming) runs in a separate
Lavalink container; the bot stays lightweight and just forwards voice updates and
sends play/queue commands. When YouTube changes, you update the audio service —
not the whole bot.

> **Why this is a modern, flagship-grade bot — not another outdated script:**
> offloaded audio (Lavalink), Discord's new **DAVE** end-to-end voice
> encryption, slash-commands-only with least-privilege intents, strict
> TypeScript, containerized with CI, and resilient by design. The full argument,
> with a legacy-vs-modern comparison and the capabilities you can light up next,
> is in **[docs/FEATURE_GUIDE.md](./docs/FEATURE_GUIDE.md)**.

## Features

- **Slash commands** for the full playback surface, with **typeahead
  autocomplete** on `/play` (a live search dropdown as you type).
- **Playback**: play / skip / stop / pause / resume, queue view, now-playing
  with a progress bar, volume, repeat (off/track/queue), shuffle,
  remove-by-position.
- **Multi-source** via Lavalink + the youtube-source plugin: YouTube, SoundCloud,
  Bandcamp, Twitch, Vimeo, direct URLs. **Spotify / Apple Music / Deezer** are an
  opt-in via the LavaSrc plugin — see [Enabling Spotify](#enabling-spotify).
- **Persistence (SQLite)**: per-guild default volume, DJ role, and **saved
  playlists** (`/playlist save|load|list|delete`) that survive restarts.
- **Hardening**: per-user command cooldowns, DJ permission gate, structured
  (pino) logging, global error handlers, auto-leave on empty channel / queue
  end, and graceful shutdown.
- **Ops**: Docker + docker-compose (bot + Lavalink), GitHub Actions CI
  (lint → typecheck → docker build), `.env`-based secrets.

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
| `/loop <mode>`                       | off / track / queue.                             |
| `/shuffle`                           | Shuffle upcoming tracks.                         |
| `/remove <position>`                 | Remove a track by its queue position.            |
| `/settings view\|dj-role`            | View settings / set the DJ role (Manage Server). |
| `/playlist save\|load\|list\|delete` | Manage saved playlists.                          |

Playback-control commands respect the **DJ role** if one is configured
(`/settings dj-role`); otherwise everyone can use them. Members with **Manage
Server** always count as DJs.

## Quick start (Docker — recommended)

Docker Compose runs both the bot and a Lavalink node together.

```bash
# 1. Configure secrets
cp .env.example .env
#   Fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, (optional) DISCORD_GUILD_ID for
#   instant command registration, and a LAVALINK_PASSWORD.

# 2. Build
docker compose build

# 3. Register slash commands (one-off; re-run when command definitions change)
docker compose run --rm bot npm run deploy

# 4. Start (bot + lavalink)
docker compose up -d
docker compose logs -f bot      # look for: "lavalink node connected" → "gateway ready"
```

Invite the bot with the `bot` and `applications.commands` scopes and the
permissions: **Connect**, **Speak**, **Send Messages**, **Embed Links**.

> Lavalink's **first** boot downloads the YouTube plugin and takes ~10–30s. The
> bot retries the node connection automatically until it's ready.

## Running without Docker

You need a **separate Lavalink v4 node** running (with the youtube-source plugin
— see `lavalink/application.yml`). Then point the bot at it via `LAVALINK_HOST` /
`LAVALINK_PORT` / `LAVALINK_PASSWORD` in `.env`, and:

```bash
npm install          # builds better-sqlite3 (the only native dep)
npm run deploy       # register slash commands
npm run dev          # or: npm start
```

### Environment variables

See [`.env.example`](./.env.example). Required: `DISCORD_TOKEN`,
`DISCORD_CLIENT_ID`. Common: `LAVALINK_PASSWORD`, `DISCORD_GUILD_ID`,
`DEFAULT_SEARCH_PLATFORM`, `DEFAULT_VOLUME`, `LOG_LEVEL`.

> **Secrets:** the bot token and Lavalink password are credentials. They live
> only in `.env`, which is gitignored — never commit them.

## Scripts

| Script              | Purpose                               |
| ------------------- | ------------------------------------- |
| `npm run dev`       | Run with file-watch (tsx).            |
| `npm start`         | Run once (tsx).                       |
| `npm run deploy`    | Register slash commands with Discord. |
| `npm run typecheck` | `tsc --noEmit`.                       |
| `npm run lint`      | ESLint.                               |
| `npm run format`    | Prettier.                             |

## Project structure

```
src/
├─ index.ts                # entry: boot, error handlers, graceful shutdown
├─ client.ts               # Client + intents + LavalinkManager + collections
├─ config.ts               # validated env config (incl. Lavalink node)
├─ commands/               # one file per slash command + index registry
├─ events/                 # ready (inits Lavalink), interactionCreate, voiceStateUpdate
├─ music/
│  ├─ player.ts            # Lavalink event wiring + raw voice forwarding
│  ├─ sources.ts           # swappable resolve(query) sourcing interface
│  └─ QueueManager.ts      # typed player/queue helpers
├─ db/                     # SQLite connection, guild settings, playlists
├─ cache/                  # in-memory TTL cache
└─ lib/                    # logger, types, interaction helpers
deploy-commands.ts         # REST slash-command registration
lavalink/application.yml   # Lavalink config (+ youtube-source plugin)
Dockerfile, docker-compose.yml
.github/workflows/ci.yml
```

## How it maps to the architecture doc

- **§1 Gateway / WebSockets** — `client.ts` (least-privilege intents: `Guilds`,
  `GuildVoiceStates`), `events/`.
- **§2 Command layer** — `commands/`, `events/interactionCreate.ts` (router +
  3-second-ack pattern via `deferReply`), `deploy-commands.ts`.
- **§3 Voice / audio offload (Lavalink, Option B)** — `lavalink/application.yml`
  + the `lavalink` compose service do the audio; `music/player.ts` forwards raw
  voice packets and reacts to Lavalink events.
- **§4 Sourcing pipeline** — `music/sources.ts`, isolated behind `resolve()`;
  the fragile YouTube extraction lives in Lavalink's plugin, not the bot.
- **§5 Queue & state** — `music/QueueManager.ts` over Lavalink's per-guild player.
- **§6 Persistence** — `db/` (SQLite via better-sqlite3).
- **§7 Caching** — `cache/` (TTL Map for guild settings).
- **§8 Rate limiting** — `@discordjs/rest` (built into discord.js) + per-user
  cooldowns in the router.
- **§10 Reliability** — error handlers + graceful shutdown in `index.ts`,
  pino logging, auto-leave in `events/voiceStateUpdate.ts`, node retry/reconnect.
- **§11 Deployment** — `Dockerfile`, `docker-compose.yml` (bot + Lavalink), CI,
  `.env` secrets.

## When YouTube breaks

Because audio is offloaded, YouTube fixes are isolated to the audio service —
you never rebuild or redeploy the bot:

1. Bump the `youtube-plugin` version in `lavalink/application.yml` to the latest
   from the [youtube-source releases](https://github.com/lavalink-devs/youtube-source).
2. `docker compose up -d --force-recreate lavalink`.

Lavalink even logs when a newer plugin is available, so you know exactly when to
do this. SoundCloud / Bandcamp / direct links are unaffected by YouTube changes.

## Enabling Spotify

Spotify (and Apple Music / Deezer) is **off by default** — the youtube-source
plugin doesn't handle it. Turn it on with Lavalink's **LavaSrc** plugin. Spotify
provides metadata only; LavaSrc bridges the actual audio from YouTube/SoundCloud.

1. Create an app at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   and copy its **Client ID** and **Client Secret** into `.env`:
   ```
   SPOTIFY_CLIENT_ID=...
   SPOTIFY_CLIENT_SECRET=...
   ```
2. In `lavalink/application.yml`, **uncomment** the LavaSrc plugin dependency and
   the `lavasrc:` config block (both are marked "OPT-IN"). Check the
   [LavaSrc releases](https://github.com/lavalink-devs/lavasrc/releases) and bump
   the version if needed.
3. Recreate just the audio service:
   ```
   docker compose up -d --force-recreate lavalink
   ```

Now Spotify track/album/playlist links work in `/play`, and `spsearch:<query>`
searches Spotify. (To make plain `/play <text>` search Spotify by default, set
`DEFAULT_SEARCH_PLATFORM=spsearch` in `.env`.)

## Scaling beyond this setup

- **Multiple Lavalink nodes** (doc §3/§9): add more entries to the manager's
  `nodes` array; lavalink-client balances sessions across them.
- **Database → Postgres**, **cache → Redis** (doc §6–§7): the `db/` and `cache/`
  modules expose small interfaces so these swaps stay local.
- **Sharding** (doc §9): wrap with discord.js `ShardingManager` near ~2,500
  guilds.

## License

MIT
