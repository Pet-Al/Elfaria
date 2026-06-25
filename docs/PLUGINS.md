# Lavalink plugins — what's installed and how the migration works

Audio runs on **Lavalink v4** with a set of plugins declared in
[`lavalink/application.yml`](../lavalink/application.yml). Some are core to how
Elfaria already works; others are **migrated to behind feature flags**, so the
proven code path stays the default until you confirm the new one works.

Every coordinate in `application.yml` has been **verified to resolve** against its
repository — one bad/unpublished coordinate makes Lavalink's `PluginManager` abort
on boot and crash-loops the **whole node**, so we don't guess versions.

## Always-on

| Plugin | Coordinate | Purpose |
|---|---|---|
| **youtube-source** | `dev.lavalink.youtube:youtube-plugin` | YouTube playback (Lavalink's built-in YouTube was removed in v4). |
| **LavaSrc** | `com.github.topi314.lavasrc:lavasrc-plugin` | Spotify / Apple Music / Deezer metadata, bridged to playable audio. |
| **SponsorBlock** | `com.github.topi314.sponsorblock:sponsorblock-plugin` | Skips sponsor/intro/outro/off-topic segments (`/sponsorblock`). |
| **LavaSearch** | `com.github.topi314.lavasearch:lavasearch-plugin` | Richer multi-type search (used by `/play` when `LAVASEARCH=true`). |
| **LavaLyrics** | `com.github.topi314.lavalyrics:lavalyrics-plugin` | Lyrics API the node serves (used by the card when `LYRICS_SOURCE=lavalink`). |
| **LavaDSPX** | `com.github.Devoxin:LavaDSPX-Plugin:0.0.5` | Extra DSP filters — Normalize / Echo (used by `/filter` when `LAVA_DSPX=true`). |
| **DuncteBot (skybot)** | `com.dunctebot:skybot-lavalink-plugin:1.7.1` | Extra sources (getyarn, clypit, ocremix, reddit, tiktok, mixcloud…) **and** the free `speak:` TTS source behind `/tts`. NSFW sources are off by default. |
| **java-timed-lyrics** | `me.duncte123:java-lyrics-plugin:1.6.6` | A second (Genius-backed, synced) LavaLyrics provider. Loaded, but **not** on the lyrics priority list — LavaSrc stays primary. |

## Flagged migrations (old path is the default)

| Plugin | Flag (`.env`) | Default | When on |
|---|---|---|---|
| **LavaLyrics** | `LYRICS_SOURCE` | `lrclib` | `lavalink` → the card's synced lyrics come from the node (`player.getCurrentLyrics()`), with an automatic **LRCLIB fallback** if it returns nothing. |
| **LavaSearch** | `LAVASEARCH` | `false` | `true` → plain-text searches try LavaSearch first (richer, multi-type results) and **fall back to the normal search** on any miss/error. |
| **LavaDSPX** | `LAVA_DSPX` | `false` | `true` → adds **Normalize** and **Echo** presets to `/filter` (applied via Lavalink `pluginFilters`). Applying any filter first **resets all filters (stock + plugin)** to a clean slate, so presets never stack. |
| **TTS** | `TTS_ENABLED` | `true` | `/tts <text>` speaks into the channel via DuncteBot's credential-free `speak:` source. Set `false` to disable the command's effect. |

> **LavaDSPX coordinate note.** The earlier crash-loop was a bad coordinate
> (`com.github.devoxin:LavaDSPX-Plugin:2.0.0` — wrong case, nonexistent version,
> 404 on JitPack). The correct one is **`com.github.Devoxin:LavaDSPX-Plugin:0.0.5`**
> (capital "Devoxin", latest tag), now verified and active. JitPack builds on
> demand, so the git tag must exist for the jar to resolve.

### Why flags?

You asked to "migrate them over but keep the old architecture until we can
confirm the new one works." So:

- The plugins are **declared** in `application.yml` (Lavalink loads them).
- The bot only **uses** a migrated plugin when its flag is flipped.
- Every new path has a **fallback to the original** (LRCLIB for lyrics, normal
  search for LavaSearch, stock EQ for filters), so flipping a flag is low-risk
  and reversible — set it back and you're exactly where you were.

## Declared but commented out (one line from enabling)

These are present in `application.yml` (so "everything's there"), but left
commented for a stated reason — uncomment to enable:

| Plugin | Coordinate | Why it's off |
|---|---|---|
| **XM** (tracker modules) | `net.esmbot:lava-xm-plugin:0.2.8` | Lives on a **third-party maven** (`projectlounge.pw`); if that host is down Lavalink won't boot — a poor reliability trade for a niche `.mod/.xm` format. |
| **Google Cloud TTS** | `com.dunctebot:tts-plugin:1.0.1` | Higher-quality neural voices, but needs **GCP service-account credentials**. DuncteBot's free `speak:` already powers `/tts`, so this is opt-in. |
| **lyrics.kt** | `dev.schlaubi.lyrics:lavalink:2.6.1` | A **second** synced-lyrics provider — redundant with java-timed-lyrics (two would compete). Pick one. |

## How to roll it out

1. **Restart Lavalink** so it downloads the new plugins:
   `docker compose up -d --force-recreate lavalink lavalink2`. Watch the logs —
   each plugin logs that it loaded. If one fails, bump its version in
   `application.yml` (check the plugin's GitHub releases) and restart.
2. **Confirm**, then flip one flag at a time in `.env` and **restart the bot**:
   - `LYRICS_SOURCE=lavalink` — play a track with lyrics; the card line should
     populate. If a track has none, it silently falls back to LRCLIB.
   - `LAVASEARCH=true` — `/play <text>` uses LavaSearch (best with LavaSrc
     sources); on any error it transparently uses the old search.
   - `LAVA_DSPX=true` — `/filter` lists **Normalize** / **Echo**; applying any
     filter resets all filters to a clean slate so presets never stack.
   - `/tts` works out of the box once the DuncteBot plugin is loaded.
3. If anything misbehaves, set the flag back and restart — no code change needed.

## Versions

Plugin coordinates/versions in `application.yml` reflect the latest verified at
the time of writing. If Lavalink fails to boot after adding one, the fix is almost
always a version bump — open the plugin's GitHub releases and update the
dependency string (same pattern as the existing entries).

## Other notable plugins (not installed)

The full catalogue is at <https://lavalink.dev/plugins>. Anything not listed
above (e.g. niche source plugins) can be added the same way once a use case comes
up — declare it, verify the coordinate resolves, then wire the bot side.
