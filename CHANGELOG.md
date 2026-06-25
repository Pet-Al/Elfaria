# Changelog

Notable changes, newest first. Elfaria is pre-1.0 and on a single rolling branch
(`claude/dazzling-hamilton-ca1gua`); these are grouped by work batch rather than
semver tags. See [docs/REFERENCE.md](./docs/REFERENCE.md) for the full reference
and [docs/GUIDE.md](./docs/GUIDE.md) to get started.

## Live card lyrics now match `/lyrics` coverage

- **The card's live synced-lyrics line now appears for far more songs.** It was
  fetched with a *synced-only, exact-match* lookup (`get?artist&track`), so messy
  YouTube titles/authors (`"… (Official Video)"`, `"Artist - Topic"`) missed even
  mainstream tracks that DO have synced lyrics on LRCLIB — while `/lyrics` found
  them via search. `fetchSyncedLyrics` now mirrors `/lyrics`: exact get per
  candidate pair, then an **LRCLIB `/search` fallback** that picks the first
  result actually carrying synced lyrics. (Songs that only have *plain*,
  untimed lyrics still can't scroll live — there's no per-line timing to sync to;
  `/lyrics` shows them in full.)



- **LavaDSPX re-enabled with the correct coordinate.** The crash-loop was a bad
  string (`com.github.devoxin:…:2.0.0` — wrong case, nonexistent version);
  verified the real one is **`com.github.Devoxin:LavaDSPX-Plugin:0.0.5`** and
  turned it back on. `/filter`'s Normalize/Echo presets work again behind
  `LAVA_DSPX`.
- **More Lavalink plugins added** (coordinates verified to resolve first — see
  [docs/PLUGINS.md](./docs/PLUGINS.md)):
  - **java-timed-lyrics** — a second (Genius-backed) synced-lyrics provider,
    loaded but not yet on the priority list (LavaSrc stays primary).
  - **DuncteBot (skybot)** was added then **pulled back out**: its 1.7.1 jar
    isn't self-contained (needs a separate `com.dunctebot:sourcemanagers` library
    that Lavalink's plugin loader doesn't fetch), so it threw `NoClassDefFoundError`
    and crash-looped the node. Disabled until a self-contained build is available.
  - **XM**, **Google Cloud TTS** and **lyrics.kt** are **declared but commented**
    (third-party-maven risk / needs creds / duplicate provider) — one line from
    enabling, each with a note.
- **`/tts <text>`** — speaks a short message into the channel via DuncteBot's free
  `speak:` source, playing **next** so it doesn't wait behind the queue. The
  command ships behind `TTS_ENABLED` (**default off**, since DuncteBot is disabled
  above); it replies "disabled" until a working TTS plugin is enabled.
- **`/favorites play` autocomplete** — start typing to pick a saved favourite by
  name (still accepts the number from `/favorites list`).
- **Autoplay-off no longer toggles back on.** Passing a `when-off` choice while
  autoplay is already off is now a no-op instead of flipping it on; the bot-leave
  reset also only acts when autoplay was actually on.
- **Public API gated to shard 0** — fixes the `EADDRINUSE :::8080` crash where
  every shard process tried to bind the same fixed API port. (Metrics already
  offsets its port per shard.)
- **Concurrency model documented + hardened.** Live card updates and commands run
  concurrently on the event loop (commands only ever do a synchronous "mark
  dirty"; edits are fire-and-forget and coalesced) — no change to the live
  behaviour, plus a defensive render-timeout so a wedged edit can't freeze a card.

## Recommend polish, card cleanup, multi-skip fix & Lavalink plugin migration

- **`/recommend` overhauled for freshness + genre.** Picks are now anchored to
  the seed track via its YouTube **mix/radio** and the seed-aware signals only —
  popularity is left out when there's a seed, fixing "EDM seed → lofi results".
  Your own most-played tracks are capped to **one** pick, so a thin history
  surfaces NEW music in the same vibe instead of replaying what you know. Added
  **`/recommend clear:true`** to remove the tracks it queued.
- **Card cleanup** — removed the duplicate 🔊 volume% under the title (the volume
  dropdown already shows it).
- **Multi-skip timer fix** — card edits are now **serialized per player** in the
  update pipeline, so rapid skips can't race two concurrent `message.edit`s and
  make the progress bar jump. (Edits across different guilds still run in
  parallel.)
- **Lavalink plugin migration (flagged, old path stays default)** — see
  [docs/PLUGINS.md](./docs/PLUGINS.md):
  - **LavaLyrics** (`LYRICS_SOURCE=lavalink`) — native synced lyrics via the
    node, with automatic LRCLIB fallback. (lavalyrics-plugin bumped 1.0.0 → 1.1.0.)
  - **LavaSearch** (`LAVASEARCH=true`) — richer search, falling back to the
    normal search on any miss.
  - **LavaDSPX** (`LAVA_DSPX=true`) — would add **Normalize** / **Echo** presets
    to `/filter`. **Disabled for now**: the JitPack coordinate 404s (no published
    build at that tag), and a missing plugin jar crash-loops the whole node, so
    it's commented out in `application.yml`. The bot code is already there and
    flag-gated — flip the flag once a working version is uncommented.
- **Lavalink boot-crash fix** — Lavalink (and `lavalink2`) were **crash-looping**
  with `FileNotFoundException … LavaDSPX-Plugin-2.0.0.jar`: one unresolvable
  plugin coordinate makes `PluginManager` abort the entire node on boot, so the
  bot's nodes never connected (all the `ECONNREFUSED`/`ENOTFOUND` noise was
  downstream of that). Commenting out the bad LavaDSPX dependency restores boot;
  every other plugin (youtube-source, LavaSrc, SponsorBlock, LavaSearch,
  LavaLyrics) loads fine.

## Update pipeline, restart-replay, modifiers & a Spotify-style recommender

- **↩️ Replay restarts the current song in place** (seek to 0) when you press it
  on the live card; on a finished/older card it still re-queues that track.
- **Dedicated card-update pipeline** (`music/panelScheduler.ts`) — one process-
  wide loop owns every now-playing edit, coalescing command bursts to one edit
  per player per tick. Commands just mark a card dirty and return, so heavy
  traffic can't stall or spam the live timer/lyrics. The old per-player interval
  and the hardcoded 3s edit floor are gone; cadence + throttle derive from
  `NOWPLAYING_REFRESH_MS` (so 1s genuinely means 1s).
- **Modifier badges on the card** — autoplay ♾️, filter 🎛️, SponsorBlock ⏭️ and
  24/7 📌 now show in the card's tags area.
- **`/modifiers`** — view every active modifier (autoplay/loop/filter/
  SponsorBlock/24-7/volume) and toggle **persistence**.
- **Modifiers reset to defaults on restart/leave by default.** Filters &
  SponsorBlock only survive when a guild opts in via `/modifiers persist:on`;
  **autoplay always resets off when the bot leaves** so it never silently resumes.
- **Longer pause timeout** — a paused player now waits `PAUSE_LEAVE_COOLDOWN_MS`
  (default **10 min**) before leaving, separate from the quick empty/queue-end
  cooldowns.
- **Multi-model recommender** (`src/ml/recsys/`, see
  [docs/RECOMMENDER.md](./docs/RECOMMENDER.md)) — a Spotify-style stack of
  independent signals (collaborative filtering, session, NLP/semantic,
  popularity, + an audio-analysis seam) fused by a BaRT-style blender with an
  exploration arm. `/recommend` runs it end to end.

## Per-second cards, per-track favorites, lofi themes & the next 5

- **Now-playing updates every second** — `NOWPLAYING_REFRESH_MS` defaults to
  `1000` (was 15000) so the progress timer **and** the synced-lyrics line tick
  live. The lyric line is driven entirely by this refresh, not a separate timer.
  At large scale raise it (one edit per active guild per second eats the ~50
  req/s global budget) or set `0` to disable live updates.
- **↩️ Replay button** added to the live card's utility row (right of 🔀 Shuffle).
- **Favorite/Replay target the card you clicked** — each card remembers its own
  track, so pressing ⭐/↩️ on an **older** card saves/replays *that* song, not
  whatever is playing now (was: always the current track).
- **Guild commands removed entirely** — Elfaria is **global-only** now; the
  guild-scoped registration path (the sole cause of doubled commands) is gone.
  `deploy:guild`/`deploy:global` scripts removed; the bot still clears any
  orphaned guild copies on boot (`CLEAR_ALL_GUILD_COMMANDS`).
- **`/lofi` is now per-theme** — `theme:` choices (chill/study/sleep/jazz/
  chillhop/synthwave/rainy), each its own search seed. Livestreams are filtered
  out (only one of the 24/7 radios reliably resolved), and continuity comes from
  **autoplay** instead of a forced queue-loop — fixes "never ends / loops the
  last 3 songs".
- **Next 5:**
  - **SponsorBlock** — `/sponsorblock on|off` skips sponsor/intro/outro/
    off-topic segments via the Lavalink SponsorBlock plugin (per-guild, persisted).
  - **User taste profiles** — autoplay now blends in a low-weight slice of the
    requester's own most-played tracks (`analytics/taste.ts`).
  - **`/recommend`** — queues picks made for you from the trained model +
    co-play + your taste, falling back to your top artist.
  - **i18n scaffold** (`lib/i18n.ts`) — `t(key, locale)` with en/es/fr/de and
    English fallback; router messages localise to the user's Discord language.
  - **Playlist name autocomplete** — `/playlist load`/`delete` suggest your own
    saved playlists, so they're usable without typing the exact name.

## Player UX & lyrics polish

- **Lyrics reliability** — LRCLIB lookups now use a 12s timeout + one retry on
  timeout/5xx. A transient timeout used to surface as "lyrics unavailable"; that
  was the long-standing "lyrics don't work".
- **`/lofi`** now loads a curated YouTube **playlist** (shuffled, queue-looped)
  instead of the 24/7 live streams the YouTube clients struggled to resolve.
- **Filters** — `/filter-save` merged into `/filter` as an optional `save:true`;
  added a **`vocal`** clarity preset (presence-band lift for singing).
- **`/dequeue` → `/autoplay-dequeue`.**
- **Now-playing card** — "up next" uses `#1` numbering; **every** retired card
  (buried/superseded, not just the final one) keeps a working Replay + Favorite,
  each with its own ~30-min expiry. Back no longer re-queues the current track
  (fixes the replay+back duplicate).
- **Doubled commands** — opt-in `CLEAR_ALL_GUILD_COMMANDS` nukes leftover
  guild-scoped commands on boot.
- **`/about`** — a one-screen tech-stack / architecture brief.
- **Boot-crash fix** — the DB queue store had to be a class (lavalink-client
  validates the prototype's methods), else the client crashed on every start.

## Data-science "big 5"

- **KEDA predictive autoscaling** (`k8s/keda-scaledobject.yaml`) on the
  `predict_linear` player forecast, with a reactive safety trigger.
- **End-to-end play canary** (`lib/playCanary.ts`) — joins a staging VC, plays a
  track, verifies the position advances (real audio), exports
  `elfaria_play_canary_success`.
- **Web dashboard** — the public API serves a read-only HTML page at `/`.
- **Nightly train/serve** (`k8s/train-cronjob.yaml`) + recommender hot-reload +
  `elfaria_recommender_*` metrics.
- **Synced lyrics** on the now-playing card (current line, from LRCLIB).
- Plus: configurable error backstop (`MAX_TRACK_ERRORS`, default 10/60s),
  **queue persistence / session migration** (DB queue store, restored on rejoin),
  **A/B framework** (`analytics/experiments.ts`), forecast + **anomaly alerts**.

## Reliability & "song randomly dies"

- The error-storm backstop (`maxErrorsPerTime`) was destroying the player on
  transient **YouTube throttling** stalls. Loosened + made configurable; the real
  fix (YouTube **OAuth**) is documented in `lavalink/application.yml`.

## Modes, history & ownership

- **`/24-7`** (renamed from `/247`) with `until-empty` / `forever` / `off`, plus
  **auto-rejoin on restart** (persists channel + mode).
- **`/replay [position]`** — integer index into history (default most recent).
- **`/history`** — unlimited & paginated (jump dropdown + Prev/Next).
- **`/status`** — live health inside Discord; **owner `/admin`** toggles
  (retention deletion, `/forget-me` access).
- Now-playing **back button**, panel expiry on crash/kick, favourite on expired
  cards; **autoplay** shows ahead in the queue + dequeues on off.
- **Lofi & 24/7** groundwork, anti-clipping EQ, robust stuck-track handling.

## Scale, ML & platform foundations

- Dynamic **seek dropdown**; auto-global command registration (idempotent).
- **Trained item2vec recommender** (offline train + inference serve).
- **SLIs/SLOs + burn-rate alerts**; **multi-pod sharding** + canary; **Postgres
  HA / read replicas**; **External Secrets** + **k6** load/soak; cross-pod
  presence via Redis.
- Full **data architecture** docs, Kafka event pipeline, public stats API, GDPR.
