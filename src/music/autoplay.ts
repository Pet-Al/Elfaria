import type { Player, SearchResult, Track } from 'lavalink-client';
import { coPlayedAfter } from '../analytics/recommend.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

/**
 * Autoplay (doc roadmap). When the queue runs dry, if autoplay is enabled for
 * the player, find a *related* track and keep the music going. Toggled per guild
 * via `/autoplay` (stored on the player with player.set('autoplay', …)).
 *
 * Recommendations come from YouTube's "mix"/radio (the RD<videoId> playlist),
 * which is genre/taste-aware rather than just same-artist. For non-YouTube
 * tracks we first find the song on YouTube to get a seed video id, so Spotify/
 * SoundCloud/etc. get the same recommendation quality. To avoid loops and "it
 * runs out" we skip recently-autoplayed tracks (a rolling per-session set) and
 * pick randomly from the remaining candidates, so it keeps going and varies.
 */

const SEEN_LIMIT = 60;

function isYouTube(track: Track): boolean {
  return track.info.sourceName === 'youtube' || track.info.sourceName === 'youtubemusic';
}

/** Find a YouTube video id to seed the radio from, for any source. */
async function seedVideoId(player: Player, track: Track): Promise<string | null> {
  if (isYouTube(track) && track.info.identifier) return track.info.identifier;
  const lookup = (await player.search(
    { query: `${track.info.author} ${track.info.title}`, source: 'ytsearch' as never },
    track.requester,
  )) as SearchResult;
  return lookup.tracks[0]?.info.identifier ?? null;
}

export async function autoPlayFunction(player: Player, lastTrack: Track | null): Promise<void> {
  if (!player.get<boolean>('autoplay') || !lastTrack) return;

  try {
    const seen = new Set(player.get<string[]>('autoplaySeen') ?? []);

    // 1. Learned: what this guild most often plays after this track (co-play CF).
    //    Resolve the top unseen suggestion; cold start (no data) falls through.
    if (lastTrack.info.uri) {
      const suggestions = await coPlayedAfter(player.guildId, lastTrack.info.uri, 5);
      for (const s of suggestions) {
        const found = (await player.search({ query: s.uri }, lastTrack.requester)) as SearchResult;
        const track = found.tracks[0];
        if (track?.info.identifier && !seen.has(track.info.identifier)) {
          await player.queue.add(track);
          rememberSeen(player, track.info.identifier);
          return;
        }
      }
    }

    // 2. Heuristic fallback: YouTube's mix/radio (genre-aware) for any source.
    const videoId = await seedVideoId(player, lastTrack);

    const result = (await player.search(
      videoId
        ? { query: `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}` }
        : // Last resort if we couldn't seed a video id: a plain artist/title search.
          {
            query: `${lastTrack.info.author} ${lastTrack.info.title}`,
            source: config.music.searchPlatform as never,
          },
      lastTrack.requester,
    )) as SearchResult;

    // Anti-repeat: never re-pick the seed or anything autoplayed recently.
    const blocked = new Set<string>([...seen, lastTrack.info.identifier, videoId ?? '']);
    const candidates = result.tracks.filter(
      (t) => t.info.identifier && !blocked.has(t.info.identifier),
    );

    const next =
      candidates[Math.floor(Math.random() * candidates.length)] ??
      result.tracks.find((t) => t.info.identifier !== lastTrack.info.identifier) ??
      result.tracks[0];
    if (!next) return;

    await player.queue.add(next);
    if (next.info.identifier) rememberSeen(player, next.info.identifier);
  } catch (err) {
    logger.warn({ err, guildId: player.guildId }, 'autoplay failed to find a related track');
  }
}

/** Append an identifier to the rolling per-session "already autoplayed" set. */
function rememberSeen(player: Player, identifier: string): void {
  const seen = player.get<string[]>('autoplaySeen') ?? [];
  player.set('autoplaySeen', [...seen, identifier].slice(-SEEN_LIMIT));
}
