import type { Player, SearchResult, Track } from 'lavalink-client';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

/**
 * Autoplay (doc roadmap). When the queue runs dry, if autoplay is enabled for
 * the player, find a related track and keep the music going. Toggled per guild
 * via `/autoplay` (stored on the player with player.set('autoplay', …)).
 *
 * "Related" comes from the YouTube mix/radio (RD<videoId>) for YouTube tracks,
 * or a best-effort artist/title search otherwise. lavalink-client calls this on
 * an empty queue; if we add a track it plays, otherwise the leave timer runs.
 */
export async function autoPlayFunction(player: Player, lastTrack: Track | null): Promise<void> {
  if (!player.get<boolean>('autoplay') || !lastTrack) return;

  const { identifier, sourceName, author, title } = lastTrack.info;

  try {
    const isYouTube = sourceName === 'youtube' || sourceName === 'youtubemusic';
    const result = (await player.search(
      isYouTube
        ? { query: `https://www.youtube.com/watch?v=${identifier}&list=RD${identifier}` }
        : { query: `${author} ${title}`, source: config.music.searchPlatform as never },
      lastTrack.requester,
    )) as SearchResult;

    // Skip the track we just played; fall back to the top result.
    const next = result.tracks.find((t) => t.info.identifier !== identifier) ?? result.tracks[0];
    if (next) await player.queue.add(next);
  } catch (err) {
    logger.warn({ err, guildId: player.guildId }, 'autoplay failed to find a related track');
  }
}
