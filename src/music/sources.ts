import type { Player, SearchResult } from 'lavalink-client';
import type { User } from 'discord.js';
import { searchCache } from '../cache/search.js';
import { config } from '../config.js';
import { searchCacheEvents, sourceResolveDuration } from '../lib/metrics.js';
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
 * popular query skips Lavalink. The resolve call is bounded by a timeout so a
 * hung source can't block a command indefinitely, and it emits cache/latency
 * metrics for observability.
 */

/** How long to wait for Lavalink to resolve a query before giving up. */
const RESOLVE_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

export async function resolve(
  player: Player,
  query: string,
  requestedBy: User,
): Promise<SearchResult> {
  const requester = requesterOf(requestedBy);
  const cacheKey = `search:${config.music.searchPlatform}:${query.toLowerCase().trim()}`;

  const cached = await searchCache.get(cacheKey);
  if (cached?.tracks.length) {
    searchCacheEvents.inc({ result: 'hit' });
    for (const track of cached.tracks) track.requester = requester;
    return cached;
  }
  searchCacheEvents.inc({ result: 'miss' });

  const end = sourceResolveDuration.startTimer();
  const result = (await withTimeout(
    player.search({ query }, requester),
    RESOLVE_TIMEOUT_MS,
    'search',
  )) as SearchResult;
  end();

  // Cache only single-track and text-search results — not playlists (large) or
  // errors/empties.
  if (result.tracks.length && (result.loadType === 'search' || result.loadType === 'track')) {
    await searchCache.set(cacheKey, result);
  }

  return result;
}
