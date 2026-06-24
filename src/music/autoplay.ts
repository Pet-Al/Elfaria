import type { Player, SearchResult, Track } from 'lavalink-client';
import { coPlayedAfter } from '../analytics/recommend.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { recommendTracks } from '../ml/recommender.js';

/**
 * Autoplay (doc roadmap). When the queue runs dry, if autoplay is enabled for
 * the player, keep the music going with *related* tracks. Toggled per guild via
 * `/autoplay` (stored on the player with player.set('autoplay', …)).
 *
 * Two behaviours the UI exposes:
 *   • A **buffer**: instead of adding a single track, we top the queue up to
 *     `config.music.autoplayBuffer` related tracks, so there's always a visible
 *     "up next" (the old behaviour put only one song in front).
 *   • A **reroll** (`/reroll`): if you don't like the suggestions, swap every
 *     autoplay-queued track for a fresh, different shuffle — keeping anything
 *     YOU queued manually.
 *
 * Recommendations come first from a learned signal (what this guild plays after
 * a track — co-play CF on the event data), then YouTube's "mix"/radio (the
 * RD<videoId> playlist), which is genre/taste-aware rather than just same-artist.
 * For non-YouTube tracks we first find the song on YouTube to get a seed video
 * id, so Spotify/SoundCloud/etc. get the same recommendation quality. A rolling
 * per-session "seen" set avoids loops/repeats, and picks are shuffled for variety.
 */

const SEEN_LIMIT = 80;
/** Per-player store keys. */
const SEEN = 'autoplaySeen';
const QUEUED = 'autoplayQueued';

function isYouTube(track: Track): boolean {
  return track.info.sourceName === 'youtube' || track.info.sourceName === 'youtubemusic';
}

/** Fisher–Yates in place — used to vary which related tracks we pick. */
function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
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

/**
 * Gather a pool of candidate related tracks, seeded from `seed`: the learned
 * co-play suggestions first, then the YouTube mix/radio (a larger pool to draw
 * a buffer from). Failures in either source are swallowed — we return whatever
 * we got so the buffer can still fill from the other.
 */
async function gatherCandidates(player: Player, seed: Track): Promise<Track[]> {
  const pool: Track[] = [];

  if (seed.info.uri) {
    // 1. Trained: item2vec nearest-neighbours from the offline-trained embeddings
    //    (most personalised). No-op when no model is loaded (cold start).
    try {
      for (const rec of recommendTracks(seed.info.uri, 10)) {
        const found = (await player.search({ query: rec.uri }, seed.requester)) as SearchResult;
        if (found.tracks[0]) pool.push(found.tracks[0]);
      }
    } catch (err) {
      logger.debug({ err, guildId: player.guildId }, 'trained recommender lookup failed');
    }

    // 2. Learned heuristic: tracks this guild most often plays after the seed
    //    (co-play CF) — works before a model has been trained.
    try {
      const suggestions = await coPlayedAfter(player.guildId, seed.info.uri, 10);
      for (const s of suggestions) {
        const found = (await player.search({ query: s.uri }, seed.requester)) as SearchResult;
        if (found.tracks[0]) pool.push(found.tracks[0]);
      }
    } catch (err) {
      logger.debug({ err, guildId: player.guildId }, 'co-play lookup failed; using mix only');
    }
  }

  // 3. Heuristic fallback: YouTube's mix/radio (genre-aware) for any source.
  const videoId = await seedVideoId(player, seed);
  const mix = (await player.search(
    videoId
      ? { query: `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}` }
      : { query: `${seed.info.author} ${seed.info.title}`, source: config.music.searchPlatform as never },
    seed.requester,
  )) as SearchResult;
  pool.push(...shuffle(mix.tracks));

  return pool;
}

/**
 * Top the queue up to the autoplay buffer with related tracks, seeded from
 * `seed`. Returns how many it added. Tracks it adds are recorded as both "seen"
 * (anti-repeat across the session) and "autoplay-queued" (so /reroll can tell
 * them apart from user-queued tracks).
 */
export async function fillAutoplayBuffer(player: Player, seed: Track): Promise<number> {
  const target = Math.max(1, config.music.autoplayBuffer);
  const need = target - player.queue.tracks.length;
  if (need <= 0) return 0;

  try {
    const seen = new Set(player.get<string[]>(SEEN) ?? []);
    const blocked = new Set<string>([...seen, seed.info.identifier]);
    const pool = await gatherCandidates(player, seed);

    const picks: Track[] = [];
    for (const track of pool) {
      const id = track.info.identifier;
      if (!id || blocked.has(id)) continue;
      blocked.add(id); // also de-dupes within this batch
      picks.push(track);
      if (picks.length >= need) break;
    }
    if (picks.length === 0) return 0;

    await player.queue.add(picks);
    for (const track of picks) {
      rememberSeen(player, track.info.identifier!);
      markQueued(player, track.info.identifier!);
    }
    return picks.length;
  } catch (err) {
    logger.warn({ err, guildId: player.guildId }, 'autoplay failed to fill the buffer');
    return 0;
  }
}

/**
 * The function lavalink-client calls when a player's queue empties (wired in
 * client.ts via onEmptyQueue.autoPlayFunction). Fills the autoplay buffer when
 * autoplay is enabled for the guild.
 */
export async function autoPlayFunction(player: Player, lastTrack: Track | null): Promise<void> {
  if (!player.get<boolean>('autoplay') || !lastTrack) return;
  await fillAutoplayBuffer(player, lastTrack);
}

/**
 * Reroll: replace every autoplay-queued upcoming track with a fresh, different
 * shuffle, keeping anything the user queued manually. The removed tracks are
 * marked "seen" so the new picks are genuinely different. Returns how many fresh
 * tracks were queued. `seed` is the track to base recommendations on (usually
 * the currently-playing one).
 */
export async function rerollAutoplay(player: Player, seed: Track): Promise<number> {
  const queued = new Set(player.get<string[]>(QUEUED) ?? []);
  const upcoming = player.queue.tracks as Track[];

  // Partition the upcoming queue into user-queued (keep) and autoplay (drop).
  const keep: Track[] = [];
  for (const track of upcoming) {
    const id = track.info.identifier;
    if (id && queued.has(id)) {
      rememberSeen(player, id); // don't suggest the same ones again
    } else {
      keep.push(track);
    }
  }

  // Clear the whole upcoming queue, then restore the user-queued tracks.
  if (upcoming.length > 0) await player.queue.splice(0, upcoming.length);
  if (keep.length > 0) await player.queue.add(keep);
  player.set(QUEUED, []);

  return fillAutoplayBuffer(player, seed);
}

/**
 * Remove every autoplay-queued track from the upcoming queue, keeping anything
 * the user queued manually. Used when autoplay is toggled OFF so the user can
 * play their own thing without the autoplay picks in the way. Returns how many
 * were dequeued.
 */
export async function clearAutoplayQueued(player: Player): Promise<number> {
  const queued = new Set(player.get<string[]>(QUEUED) ?? []);
  if (queued.size === 0) return 0;

  const upcoming = player.queue.tracks as Track[];
  const keep = upcoming.filter((t) => !t.info.identifier || !queued.has(t.info.identifier));
  const removed = upcoming.length - keep.length;

  if (upcoming.length > 0) await player.queue.splice(0, upcoming.length);
  if (keep.length > 0) await player.queue.add(keep);
  player.set(QUEUED, []);
  return removed;
}

/** Append an identifier to the rolling per-session "already autoplayed" set. */
function rememberSeen(player: Player, identifier: string): void {
  const seen = player.get<string[]>(SEEN) ?? [];
  player.set(SEEN, [...seen, identifier].slice(-SEEN_LIMIT));
}

/** Track which queued identifiers were added by autoplay (for /reroll). */
function markQueued(player: Player, identifier: string): void {
  const queued = player.get<string[]>(QUEUED) ?? [];
  player.set(QUEUED, [...queued, identifier].slice(-SEEN_LIMIT));
}
