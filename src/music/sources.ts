import { type Player, QueryType, type SearchResult, type Track } from 'discord-player';
import type { User } from 'discord.js';
import { cache } from '../cache/index.js';

/**
 * Sourcing layer (doc §4).
 *
 * This is the single interface the rest of the bot uses to turn a user's query
 * (a song name, a YouTube/SoundCloud/Spotify link) into playable tracks. It is
 * deliberately thin and isolated: YouTube extractors break constantly, so when
 * sourcing changes we update the extractor registration (see player.ts) and,
 * if needed, this file — never the command logic.
 *
 * Resolved searches are cached (doc §7) so replaying a popular query doesn't
 * re-hit the source API every time.
 */

const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;

export interface ResolveResult {
  tracks: Track[];
  /** Set when the query resolved to a playlist/album rather than a single track. */
  playlistName: string | null;
  source: SearchResult;
}

/**
 * Resolve a query to one or more tracks. Returns `null` when nothing matched.
 *
 * We let discord-player auto-detect the query type (link vs. text search). The
 * cache key combines the raw query and requester-agnostic engine so different
 * users replaying the same song share the cached resolution.
 */
export async function resolve(
  player: Player,
  query: string,
  requestedBy: User,
): Promise<ResolveResult | null> {
  const key = `search:${query.toLowerCase().trim()}`;
  const cached = cache.get<ResolveResult>(key);
  if (cached) return cached;

  const result = await player.search(query, {
    requestedBy,
    searchEngine: QueryType.AUTO,
  });

  if (!result.hasTracks()) return null;

  const resolved: ResolveResult = {
    tracks: result.tracks,
    playlistName: result.playlist?.title ?? null,
    source: result,
  };

  // Only cache plain searches; links are cheap to re-resolve and may be transient.
  cache.set(key, resolved, SEARCH_CACHE_TTL_MS);
  return resolved;
}
