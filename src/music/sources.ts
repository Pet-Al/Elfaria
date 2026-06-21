import type { Player, SearchResult } from 'lavalink-client';
import type { User } from 'discord.js';
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
 * Lavalink auto-detects links; for plain text it applies the player's default
 * search platform (config.music.searchPlatform).
 */
export async function resolve(
  player: Player,
  query: string,
  requestedBy: User,
): Promise<SearchResult> {
  // We only ever do resolved searches, so the result is a SearchResult.
  return player.search({ query }, requesterOf(requestedBy)) as Promise<SearchResult>;
}
