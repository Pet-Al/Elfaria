import type { LavaSearchResponse, Player, SearchResult } from 'lavalink-client';
import type { User } from 'discord.js';
import { recordEvent } from '../analytics/events.js';
import { searchCache } from '../cache/search.js';
import { config } from '../config.js';
import { CircuitBreaker } from '../lib/circuitBreaker.js';
import { searchCacheEvents, sourceResolveDuration } from '../lib/metrics.js';
import { withSpan } from '../lib/tracing.js';
import { requesterOf } from './QueueManager.js';

/** Fast-fail resolution while Lavalink is repeatedly failing, instead of hammering it. */
const breaker = new CircuitBreaker(5, 30_000);

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

/**
 * Try the LavaSearch plugin (richer, multi-type results) for a plain-text query.
 * Returns a normal SearchResult built from its tracks, or null on empty/error/no
 * plugin — so the caller falls back to the standard search. LavaSearch is geared
 * to LavaSrc sources; on an unsupported source it simply throws and we return null.
 */
async function tryLavaSearch(
  player: Player,
  query: string,
  requester: ReturnType<typeof requesterOf>,
): Promise<SearchResult | null> {
  try {
    const res = (await player.lavaSearch(
      { query, source: config.music.searchPlatform as never, types: ['track', 'playlist'] },
      requester,
    )) as LavaSearchResponse;
    const tracks = res?.tracks ?? [];
    if (!tracks.length) return null;
    return {
      loadType: 'search',
      exception: null,
      pluginInfo: {},
      playlist: null,
      tracks,
    } as SearchResult;
  } catch {
    return null;
  }
}

export async function resolve(
  player: Player,
  query: string,
  requestedBy: User,
): Promise<SearchResult> {
  const requester = requesterOf(requestedBy);
  recordEvent({ type: 'search', guildId: player.guildId, userId: requestedBy.id, query });
  const cacheKey = `search:${config.music.searchPlatform}:${query.toLowerCase().trim()}`;

  const cached = await searchCache.get(cacheKey);
  if (cached?.tracks.length) {
    searchCacheEvents.inc({ result: 'hit' });
    for (const track of cached.tracks) track.requester = requester;
    return cached;
  }
  searchCacheEvents.inc({ result: 'miss' });

  if (breaker.isOpen()) {
    throw new Error('the audio source is temporarily unavailable, try again shortly');
  }

  const end = sourceResolveDuration.startTimer();
  let result: SearchResult;
  try {
    // Optional LavaSearch (richer results) for plain-text queries — only when
    // enabled, and it FALLS BACK to the normal search on any miss/error, so the
    // proven path stays the safety net (migrate-but-keep-old).
    const rich =
      config.plugins.lavaSearch && !/^https?:\/\//i.test(query)
        ? await tryLavaSearch(player, query, requester)
        : null;
    result =
      rich ??
      (await withSpan('source.resolve', { 'elfaria.platform': config.music.searchPlatform }, () =>
        withTimeout(
          player.search({ query }, requester) as Promise<SearchResult>,
          RESOLVE_TIMEOUT_MS,
          'search',
        ),
      ));
    breaker.recordSuccess();
  } catch (err) {
    breaker.recordFailure();
    throw err;
  } finally {
    end();
  }

  // Cache only single-track and text-search results — not playlists (large) or
  // errors/empties.
  if (result.tracks.length && (result.loadType === 'search' || result.loadType === 'track')) {
    await searchCache.set(cacheKey, result);
  }

  return result;
}
