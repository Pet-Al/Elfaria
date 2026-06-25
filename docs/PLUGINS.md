# Lavalink plugins — what's installed and how the migration works

Audio runs on **Lavalink v4** with a set of plugins declared in
[`lavalink/application.yml`](../lavalink/application.yml). Some are core to how
Elfaria already works; three more are being **migrated to behind feature flags**,
so the proven code path stays the default until you confirm the new one works.

## Always-on

| Plugin | Purpose |
|---|---|
| **youtube-source** | YouTube playback (Lavalink's built-in YouTube was removed in v4). |
| **LavaSrc** | Spotify / Apple Music / Deezer metadata, bridged to playable audio. |
| **SponsorBlock** | Skips sponsor/intro/outro/off-topic segments (`/sponsorblock`). |

## Being migrated to (flagged — old path is the default)

| Plugin | Flag (`.env`) | Default | When on |
|---|---|---|---|
| **LavaLyrics** | `LYRICS_SOURCE` | `lrclib` | `lavalink` → the card's synced lyrics come from the node (`player.getCurrentLyrics()`), with an automatic **LRCLIB fallback** if it returns nothing. |
| **LavaSearch** | `LAVASEARCH` | `false` | `true` → plain-text searches try LavaSearch first (richer, multi-type results) and **fall back to the normal search** on any miss/error. |
| **LavaDSPX** ⚠️ | `LAVA_DSPX` | `false` | `true` → adds **Normalize** and **Echo** presets to `/filter` (applied via Lavalink `pluginFilters`). **Currently disabled in `application.yml`** — see below. |

> **⚠️ LavaDSPX is commented out in `application.yml` right now.** The published
> JitPack coordinate I had (`com.github.devoxin:LavaDSPX-Plugin:2.0.0`) **404s**,
> and a missing plugin jar makes Lavalink's `PluginManager` abort on boot — which
> takes the **whole node** down (crash-loop). Because the bot's DSPX path is
> flag-gated (`LAVA_DSPX=false`) and fail-soft, leaving the plugin out changes
> nothing user-facing: `/filter` simply won't list Normalize/Echo. To enable it,
> confirm a working tag exists at
> <https://github.com/devoxin/LavaDSPX-Plugin/releases> (JitPack builds on demand,
> so the git tag must exist), uncomment the dependency in `application.yml`, then
> set `LAVA_DSPX=true`.

### Why flags?

You asked to "migrate them over but keep the old architecture until we can
confirm the new one works." So:

- The plugins are **declared** in `application.yml` (Lavalink loads them).
- The bot only **uses** a plugin when its flag is flipped.
- Every new path has a **fallback to the original** (LRCLIB for lyrics, normal
  search for LavaSearch, stock EQ for filters), so flipping a flag is low-risk
  and reversible — set it back and you're exactly where you were.

## How to roll it out

1. **Restart Lavalink** so it downloads the new plugins:
   `docker compose up -d --force-recreate lavalink`. Watch the logs — each plugin
   logs that it loaded. If one fails, bump its version in `application.yml`
   (check the plugin's GitHub releases) and restart.
2. **Confirm**, then flip one flag at a time in `.env` and **restart the bot**:
   - `LYRICS_SOURCE=lavalink` — play a track with lyrics; the card line should
     populate. If a track has none, it silently falls back to LRCLIB.
   - `LAVASEARCH=true` — `/play <text>` uses LavaSearch (best with LavaSrc
     sources); on any error it transparently uses the old search.
   - `LAVA_DSPX=true` — **only after** uncommenting the LavaDSPX dependency in
     `application.yml` with a confirmed-working version (see the ⚠️ note above);
     `/filter` then lists **Normalize** / **Echo**. Applying any filter first
     **resets all filters (stock + plugin) to a clean slate**, so presets never
     stack — switching gives exactly that preset's values.
3. If anything misbehaves, set the flag back and restart — no code change needed.

## Versions

Plugin coordinates/versions in `application.yml` reflect the latest at the time
of writing. If Lavalink fails to boot after adding one, the fix is almost always
a version bump — open the plugin's GitHub releases and update the dependency
string (same pattern as the existing youtube-source / LavaSrc entries).

## Other notable plugins (not installed)

`LavaLyrics`-family alternatives (`java-timed-lyrics`, `lyrics.kt`), `DuncteBot`
(niche sources + TTS), Google Cloud **TTS**, and `XM` (tracker modules) are
available if a use case comes up — see <https://lavalink.dev/plugins>.
