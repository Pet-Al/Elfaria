# Elfaria guide

A friendly walkthrough for three audiences: **listeners** using the bot,
**server admins** configuring it, and **developers/operators** running it. For
the exhaustive list of everything, see **[REFERENCE.md](./REFERENCE.md)**.

---

## For listeners

**Play something.** Join a voice channel and run `/play <song, link, or search>`.
`/play` has live autocomplete — start typing and pick a result. YouTube,
SoundCloud, Bandcamp, Twitch, Vimeo, direct links, and Spotify/Apple/Deezer links
all work.

**The now-playing card.** One tidy card updates in place as songs change:

- Buttons: ⏮️ back · ⏯️ play/pause · ⏭️ skip · ⏹️ stop · 📜 queue, plus ⭐ Favorite
  and 🔀 Shuffle.
- Dropdowns: **Loop** (track/queue × once/infinite), **Volume**, and **Seek**
  (jump points that scale with the track length).
- A live progress bar and the **current lyric line** (when available).
- When a song's card is retired it keeps **Replay** + **Favorite** for ~30 min,
  so you can still bring a track back or save it.

**Keep the music going.** `/autoplay` queues related tracks ahead of time (you'll
see them in "up next"). Don't like the picks? `/reroll` for a fresh set, or
`/autoplay-dequeue` to drop them. Turning autoplay off can dequeue them too
(`/autoplay when-off:dequeue`).

**Chill mode.** `/lofi` loads a looped lofi playlist. `/24-7` keeps the bot in the
channel after the queue ends — `until-empty` (leaves if everyone does), `forever`
(stays regardless), or `off`. It even rejoins and resumes after a restart.

**Find & revisit.** `/lyrics` for the full lyrics, ⭐ to favourite (then
`/favorites`), `/history` to browse what's played (paged), and
`/replay [position]` to play something from history again.

**Sound.** `/filter` for EQ/effects — bass boost, nightcore, vaporwave, 8D,
karaoke, lowpass, pop/rock/electronic, and **vocal** (clearer singing). `/volume`
sets the level. `/status` shows live health; `/about` explains what powers it.

---

## For server admins

- **DJ role.** `/settings` sets a DJ role; once set, the playback controls
  (skip/stop/filters/etc.) require that role (or Manage Server / Admin). With no
  DJ role, everyone can use them.
- **Default volume** is configurable per guild via `/settings` (and `/volume`).
- **Privacy.** Members can erase their own data with `/forget-me`. What's stored
  and the retention window are in **[../PRIVACY.md](../PRIVACY.md)**.

---

## For operators (running Elfaria)

### Quick start (Docker)

```bash
cp .env.example .env        # fill in DISCORD_TOKEN + DISCORD_CLIENT_ID
docker compose up -d        # bot + Lavalink + Postgres
```

Commands **auto-register globally on boot** — no separate step. (Global
propagation can take up to ~1h the first time a *new* command name appears.) For
instant iteration in one test server, set `DISCORD_GUILD_ID` and
`npm run deploy:guild`.

### Configuration

`.env` is the single source of truth (read at startup — **restart to apply**, no
rebuild needed for env changes). Every variable is annotated in
[`.env.example`](../.env.example) and tabulated in
[REFERENCE.md](./REFERENCE.md#configuration-env-vars).

### Common operations

| Want to… | Do |
|----------|----|
| Lyrics/playback cutting out | enable YouTube **OAuth** in `lavalink/application.yml`, recreate Lavalink (throttling fix — see README "The song randomly dies"). |
| Kill doubled commands | set `CLEAR_ALL_GUILD_COMMANDS=true`, reboot once, set it back. |
| Train the recommender | `npm run train` (or the nightly `k8s/train-cronjob.yaml`). |
| Turn on the public API/dashboard | `API_ENABLED=true`, browse `:8080/`. |
| Owner-only toggles | `/admin retention off`, `/admin forget-me off` (set `OWNER_ID`). |

### Scaling

- **One process** is right below ~2,500 guilds.
- **Sharding / multi-pod / canary** — [SCALING_SHARDING.md](./SCALING_SHARDING.md).
- **Audio autoscaling** (HPA / KEDA predictive) — [../k8s/](../k8s/) and
  [../k8s/monitoring/](../k8s/monitoring/).
- **Data tier HA / read replicas** — [DATA.md](./DATA.md) + `k8s/postgres-ha.yaml`.
- **SLOs & alerts** — [SLO.md](./SLO.md).

---

## For developers (picking up the codebase)

1. **Read order:** this guide → [REFERENCE.md](./REFERENCE.md) (source tree +
   modules) → [ARCHITECTURE_COMPARISON.md](./ARCHITECTURE_COMPARISON.md) (the
   *why*) → [DATA.md](./DATA.md) and [RELIABILITY.md](./RELIABILITY.md).
2. **Run it:** `npm install`, set `.env`, `npm run dev` (needs a Lavalink node —
   `docker compose up -d lavalink`).
3. **Add a command:** create `src/commands/foo.ts` exporting a `Command`
   (`{ data: SlashCommandBuilder, execute }`), then add it to the array in
   `src/commands/index.ts`. It auto-registers on next boot.
4. **Before pushing:** `npm run typecheck && npm run lint && npm test`. CI runs
   the same plus a coverage gate and a Trivy image scan.
5. **Conventions:** strict TypeScript, ESM with `.js` import extensions, async
   `DbDriver` with `?` placeholders (dialect-agnostic), fail-soft side-effects
   (analytics/lyrics/cache never break playback), and one validated `config`.

Tests live next to code as `*.test.ts` (Node's built-in runner). Good examples to
copy: `commands/handlers.test.ts` (mocked interactions), `db/db.test.ts`
(ephemeral SQLite), `ml/sgns.test.ts` (the model learns), `lib/lyrics.test.ts`.
