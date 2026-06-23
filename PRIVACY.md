# Elfaria — Privacy Notice

This is a template privacy notice for self-hosters. **You** (the operator running
the bot) are the data controller; fill in your contact details and publish this
where your users can find it (e.g. your support server / bot listing).

## What we store

| Data | Where | Why |
|---|---|---|
| Guild ID + settings (default volume, DJ role) | `guild_settings` | Per-server configuration. Not personal data. |
| Saved playlists (name, owner ID, track URLs) | `playlists`, `playlist_tracks` | The `/playlist` feature. Contains the owner's user ID. |
| ⭐ Favorites (user ID, track) | `favorites` | The favorite button / `/favorites`. Per-user. |
| Play history (guild, track, requester ID) | `play_history` | `/history` and `/replay`. |
| Analytics events (play/skip/search, guild ID, user ID, query/track) | `events` | Operational analytics + the co-play recommender. |

We do **not** store message content (the bot uses slash commands only and does
not request the Message Content intent), voice audio, or payment data. Search
queries you type are stored as analytics events.

## Legal basis & purpose

Data is processed to provide the music features you invoke and to operate/improve
the service (recommendations, capacity). For EU/UK users the basis is legitimate
interest in running the requested service; no data is sold or shared with third
parties for advertising.

## Retention

Play history and analytics events older than `DATA_RETENTION_DAYS` (default **90**)
are automatically pruned daily. Settings, playlists, and favorites persist until
deleted by you or the user.

## Your rights (GDPR / CCPA)

- **Erasure** — run **`/forget-me`** in any server with the bot: it deletes your
  favorites and analytics events and removes your ID from play-history attribution.
- **Access / portability / correction** — contact the operator (below).

## Third parties

- **Discord** — the platform the bot runs on (their privacy policy applies).
- **Audio sources** (YouTube, SoundCloud, Spotify metadata, …) and **LRCLIB**
  (lyrics) are queried to fulfil playback/lyrics requests.
- **Self-hosted infra** (Lavalink, Postgres, optionally Redis/Kafka) is under the
  operator's control.

## Contact

Operator: _your name / handle_ — _your contact email / support server_.
