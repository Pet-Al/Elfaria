import type { Player, SearchResult } from 'lavalink-client';
import type { User } from 'discord.js';
import { searchCache } from '../cache/search.js';
import { config } from '../config.js';
import { requesterOf } from './QueueManager.js';

/**
 * Sourcing layer (doc §4).
 *
 * The single interface the rest of the bot uses to turn a user's query (text or
 * a link) into playable tracks. With Lavalink the heavy, fragile extraction work
 * lives in the audio service (and its source plugins) — when YouTube changes you
 * update Lavalink, not the bot. This wrapper keeps that boundary in one place so
 * command logic never talks to the search API directly.
 *
 * Plain-text searches are cached (in-memory, or Redis when configured) so a
 * popular query skips Lavalink. Links and playlists are not cached (they're
 * cheap/unique to re-resolve). The cached result's tracks are re-stamped with
 * the current requester so "requested by" stays correct per play.
 */
export async function resolve(
  player: Player,
  query: string,
  requestedBy: User,
): Promise<SearchResult> {
  const requester = requesterOf(requestedBy);
  const cacheKey = `search:${config.music.searchPlatform}:${query.toLowerCase().trim()}`;

  const cached = await searchCache.get(cacheKey);
  if (cached?.tracks.length) {
    for (const track of cached.tracks) track.requester = requester;
    return cached;
  }

  const result = (await player.search({ query }, requester)) as SearchResult;

  // Cache only single-track and text-search results — not playlists (large) or
  // errors/empties.
  if (result.tracks.length && (result.loadType === 'search' || result.loadType === 'track')) {
    await searchCache.set(cacheKey, result);
  }

  return result;
}
