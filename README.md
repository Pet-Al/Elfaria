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
> is in **[docs/FEATURE_GUIDE.md](./docs/FEATURE_GUIDE.md)**. For an honest,
> evidence-backed comparison against production architectures (Discord, Netflix,
> 12-factor/SRE) — what Elfaria has and what it's missing — see
> **[docs/ARCHITECTURE_COMPARISON.md](./docs/ARCHITECTURE_COMPARISON.md)**.
> Kubernetes autoscaling for the audio tier lives in **[k8s/](./k8s/)**.

## Features

- **Slash commands** for the full playback surface, with **typeahead
  autocomplete** on `/play` (a live search dropdown as you type).
- **Playback**: play / skip / stop / pause / resume, queue view, now-playing
  with a progress bar, volume, repeat (off/track/queue), shuffle,
  remove-by-position.
- **Rich now-playing card** (Components V2): artwork-tinted accent (kept even
  when the panel retires), source badge, volume/loop indicators, an "up next"
  preview, and a **live-updating progress bar**. The card updates **in place** as
  songs change (unless the channel has moved on), so it doesn't spam.
- **Now-playing controls**: ⏯️ ⏭️ ⏹️ 🔀 📜 buttons, a compact 🔉/🔊 volume row, a
  **⭐ favorite** button, and a **loop dropdown** (track/queue × once/infinite),
  with the same voice/DJ guards as the commands.
- **History & replay**: `/history` lists recently played tracks; `/replay` (and
  a one-click Replay button when the queue finishes) replays the last one.
- **Favorites**: ⭐ a track to save it, then `/favorites list|play` to revisit.
- **Autoplay** (`/autoplay`): keep playing related tracks when the queue ends.
- **Audio filters/EQ** (`/filter`): bass boost, nightcore, vaporwave, 8D,
  karaoke, lowpass, and EQ presets — done by Lavalink, no quality cost on the bot.
- **Multi-source** via Lavalink: YouTube, SoundCloud, Bandcamp, Twitch, Vimeo,
  direct URLs, plus **Spotify / Apple Music / Deezer** through the bundled
  LavaSrc plugin (Spotify just needs free API credentials — see
  [Enabling Spotify](#enabling-spotify)).
- **Persistence (Postgres in Docker, SQLite for local dev)**: per-guild default
  volume, DJ role, **saved playlists**, **play history**, and **favorites** that
  survive restarts. The same async data layer runs on either engine; Docker uses
  one shared Postgres so the small and scaled stacks see identical data.
- **Hardening**: per-user command cooldowns, DJ permission gate, structured
  (pino) logging, Prometheus `/metrics`, global error handlers, auto-leave on
  empty channel / queue end, and graceful shutdown.
- **Ops**: Docker + docker-compose (bot + Lavalink + Postgres), GitHub Actions CI
  (lint → typecheck → test → docker build), `.env`-based secrets.

## Commands

| Command                              | Description                                      |
| ------------------------------------ | ------------------------------------------------ |
| `/ping`                              | Liveness + gateway latency.                      |
| `/play <query>`                      | Play a song or playlist (search text or URL).    |
| `/skip`                              | Skip the current track.                          |
| `/skipto <position>`                 | Jump straight to a queue position.               |
| `/seek <to>`                         | Jump to a position in the track (e.g. `1:30`).   |
| `/clear`                             | Clear upcoming tracks (keeps the current song).  |
| `/stop`                              | Stop, clear the queue, leave the channel.        |
| `/pause`, `/resume`                  | Pause / resume playback.                         |
| `/queue [page]`                      | Show the queue.                                  |
| `/nowplaying`                        | Live now-playing card (progress, source, loop, up-next). |
| `/volume [level]`                    | Show or set volume (0–100); persisted per guild. |
| `/loop <mode>`                       | off / track ×1 / track ∞ / queue ×1 / queue ∞.   |
| `/shuffle`                           | Shuffle upcoming tracks.                         |
| `/remove <position>`                 | Remove a track by its queue position.            |
| `/autoplay`                          | Toggle related-track autoplay when the queue ends. |
| `/filter <type>`                     | Apply an audio filter / EQ preset.               |
| `/history [count]`                   | Recently played tracks in this server.           |
| `/replay`                            | Play the most recently played track again.       |
| `/favorites list\|play`              | List or play your ⭐ favorited tracks.            |
| `/settings view\|dj-role`            | View settings / set the DJ role (Manage Server). |
| `/playlist save\|load\|list\|delete` | Manage saved playlists.                          |

Every now-playing card also has **buttons + a loop dropdown**: ⏯️ ⏭️ ⏹️ 🔀 📜,
a compact 🔉 −25 / 🔊 +25 / ⭐ favorite row, and a loop dropdown. The card updates
in place as the song changes; when the queue finishes it becomes a final card
with a one-shot **↩️ Replay** button. `/play` replies **privately** and just
updates the card's "up next" rather than posting a new message per track.

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

## Updating (after `git pull`)

`docker compose run`/`exec` use the **built image**, not your working tree — so a
`git pull` alone changes nothing until you rebuild. The canonical update is:

```bash
git pull
docker compose build                       # rebuild the bot image with new code
docker compose up -d --force-recreate      # recreate bot (new image) + lavalink (reload application.yml)
docker compose run --rm bot npm run deploy # only when command definitions changed
```

- `docker compose build` only rebuilds the **bot** image (Lavalink is a prebuilt
  image). Lavalink config lives in the bind-mounted `lavalink/application.yml`,
  so it's picked up by `--force-recreate`, not by `build`.
- You can scope a recreate to one service: `docker compose up -d --force-recreate lavalink`.
- **Switching between the base and scale stacks** leaves the scale-only
  containers (`lavalink2`, `redis`) behind as *orphans*, which can hold stale
  network state. Clear them with:
  ```bash
  docker compose down --remove-orphans
  docker compose up -d
  ```

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

See [`.env.example`](./.env.example).

- **Required:** `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`.
- **Common:** `LAVALINK_PASSWORD`, `DISCORD_GUILD_ID`, `DEFAULT_SEARCH_PLATFORM`,
  `DEFAULT_VOLUME`, `LOG_LEVEL`.
- **Spotify (optional):** `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` — see
  [Enabling Spotify](#enabling-spotify).

> **Secrets:** the bot token, the Lavalink password, and the Spotify client
> secret are all credentials. They live only in `.env`, which is gitignored —
> never commit them.

## Scripts

| Script              | Purpose                               |
| ------------------- | ------------------------------------- |
| `npm run dev`       | Run with file-watch (tsx).            |
| `npm start`         | Run once (tsx).                       |
| `npm run deploy`    | Register slash commands with Discord. |
| `npm run deploy:list` | Print which commands are registered globally vs. per-guild (diagnose duplicates). |
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

## Duplicate (doubled) slash commands

If a command shows up twice in Discord, you have **both** a global and a
per-guild copy — usually a leftover global registration from an earlier deploy.
Fix it:

```bash
docker compose build                              # IMPORTANT: refresh the image after git pull
docker compose run --rm bot npm run deploy:list   # see global vs guild counts
docker compose run --rm bot npm run deploy        # re-registers guild + clears global
```

> **`docker compose run` uses the built image, not your working files.** After
> any `git pull` you must `docker compose build` first, or the container keeps
> running the old code (a stale image is why a new script can read
> "Missing script" or an updated deploy behaves like the old one).

`deploy` (with `DISCORD_GUILD_ID` set) clears the global set automatically.
Discord can take **up to ~1 hour** to drop global commands from clients, so
restart your Discord app (Ctrl+R) to refresh sooner.

## Enabling Spotify

The **LavaSrc** plugin (which handles Spotify / Apple Music / Deezer) ships
enabled — you only need to add Spotify credentials. Spotify provides metadata
only; LavaSrc bridges the actual audio from YouTube/SoundCloud.

1. Create an app at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   and copy its **Client ID** and **Client Secret** into `.env`:
   ```
   SPOTIFY_CLIENT_ID=...
   SPOTIFY_CLIENT_SECRET=...
   ```
2. Apply it:
   ```
   docker compose up -d --force-recreate lavalink
   ```

Now Spotify track/album/playlist links work in `/play`, and `spsearch:<query>`
searches Spotify. (To make plain `/play <text>` search Spotify by default, set
`DEFAULT_SEARCH_PLATFORM=spsearch` in `.env`.)

> **Is this safe for my Spotify account?** Yes. This uses the Spotify **Web API**
> with **app credentials** (Client ID + Secret), *not* your username/password —
> the bot never logs into your account, so there's nothing to get banned. A
> **free** Spotify account can create the app; **Premium is not required** (the
> API is metadata-only, and audio is sourced from YouTube/SoundCloud, so no
> Spotify audio is streamed). Treat the Client Secret like a password and keep it
> in `.env`.

## Scaling (doc §9)

Everything below is **built in and config-activated** — defaults keep the bot a
single process so nothing changes until you opt in. You almost certainly don't
need any of this below a few thousand guilds.

- **Multiple Lavalink nodes** — set `LAVALINK_NODES` to a JSON array (see
  `.env.example`). lavalink-client balances player sessions across all nodes;
  leave it empty to use the single node from `LAVALINK_HOST/PORT/PASSWORD`.
- **Shared cache → Redis** — set `REDIS_URL` (and enable the `redis` service in
  `docker-compose.yml`). The search cache then lives in Redis so every
  process/shard shares it; empty = in-memory per process.
- **Sharding** — required by Discord near ~2,500 guilds. Set `SHARDING=on` and
  run `npm run start:sharded` (or override the compose `command` to
  `npm run start:sharded`). The launcher (`src/shard.ts`) spawns one bot process
  per shard via `ShardingManager`; each shard is an ordinary process with its own
  Lavalink connection, and discord.js injects the shard id/count automatically.
- **Database → Postgres** — set `DATABASE_URL=postgres://…` (and enable the
  `postgres` service in `docker-compose.yml`). The `db/` layer runs the same
  dialect-agnostic queries on either engine; leave it empty for the embedded
  SQLite file (default). Schema is auto-created on first boot.

> Activate these only as you actually grow. A single process + one Lavalink node
> comfortably serves many servers; sharding a small bot just adds moving parts.

## Verifying the scale-out features

To see all four working at once, bring up the full distributed stack with the
override file (2 Lavalink nodes + Redis + Postgres + the bot sharded):

```bash
docker compose -f docker-compose.yml -f docker-compose.scale.yml up -d --build
docker compose run --rm bot npm run deploy          # register commands (first time)
```

### How the compose files layer

`-f docker-compose.yml -f docker-compose.scale.yml` **merges** the two files, and
**later files win**. The base file is your single-machine setup (bot + one
Lavalink, single process, SQLite, reading `.env`). The override *adds* services
(`lavalink2`, `redis`, `postgres`), swaps the bot's command to `start:sharded`,
and sets the scale env vars (`LAVALINK_NODES`, `REDIS_URL`, `DATABASE_URL`,
`SHARDING`, `SHARD_COUNT`) **directly in the service's `environment:` block**.

Environment-variable precedence for a service, lowest → highest:

1. values baked into the image (`ENV` in the Dockerfile)
2. `env_file: .env` (your `.env`)
3. the service's `environment:` block in the compose file
4. variables exported in the shell that runs `docker compose`

So when you launch **with both `-f` flags**, the override's `environment:` (step 3)
**always wins over your `.env`** (step 2) — the distributed stack runs with its
own node/Redis/Postgres/sharding values no matter what `.env` says. When you
launch the **base file alone**, there's no override, so `.env` is what applies —
which is why scale vars set in `.env` would make the base file try to reach
services it doesn't start. Keep scale switches in the override, defaults in `.env`.

> Tip: `${VAR:-default}` inside a compose file means "use `$VAR` from `.env`/shell,
> else this default". That's why `LAVALINK_PASSWORD` flows from `.env` into both
> containers, while `LAVALINK_NODES` in the scale file is a hard-coded literal.

Then verify each (all commands below are run from the project directory):

**Sharding** — the bot runs as 2 shard processes:
```bash
docker compose logs bot | grep -E "launched shard|gateway ready"
# → "launched shard 0", "launched shard 1", and two "gateway ready" lines
```

**Multiple Lavalink nodes** — both nodes connect, and you can see which node
serves playback:
```bash
docker compose logs bot | grep "lavalink node connected"
# → one line for node "main" and one for node "second" (×2 with 2 shards)
docker compose logs bot | grep "playback started"      # after you /play something
# → includes  node: "main"  or  node: "second"  (sessions balance across them)
```

**Redis shared cache** — the bot logs the backend, and you can watch keys appear:
```bash
docker compose logs bot | grep "using Redis backend"
/play lofi beats        # run this in Discord (a text search, not a link)
docker compose exec redis redis-cli KEYS 'search:*'
# → a cached search key now exists in Redis
```

**Postgres** — the bot logs the dialect, and rows land in Postgres:
```bash
docker compose logs bot | grep -iE "using Postgres|database initialised"
# in Discord: run  /settings dj-role  (pick a role)  and/or  /playlist save <name>
docker compose exec postgres psql -U elfaria -d elfaria -c '\dt'
# → guild_settings, playlists, playlist_tracks
docker compose exec postgres psql -U elfaria -d elfaria -c 'SELECT * FROM guild_settings;'
# → the row you just wrote
```

Tear down the test stack (Postgres data persists in the `elfaria-pg` volume):
```bash
docker compose -f docker-compose.yml -f docker-compose.scale.yml down
```

> This stack is heavier (two JVMs + sharded bot). It's for verification/testing;
> for normal use run the base `docker compose up -d`.

## License

MIT
