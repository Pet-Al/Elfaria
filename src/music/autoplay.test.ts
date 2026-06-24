import assert from 'node:assert/strict';
import test from 'node:test';
import type { Player, Track } from 'lavalink-client';
import { clearAutoplayQueued, fillAutoplayBuffer, rerollAutoplay } from './autoplay.js';

/** Minimal Track stub. `uri: ''` keeps tests off the DB (skips the co-play lookup). */
function track(id: string): Track {
  return {
    info: {
      identifier: id,
      title: id,
      author: 'Artist',
      uri: '',
      sourceName: 'youtube',
      duration: 200_000,
      isStream: false,
    },
    requester: { id: 'u', username: 'u' },
  } as unknown as Track;
}

/**
 * A tiny in-memory Player double: a key/value store, a mutable queue with
 * add/splice, and a search() that returns a fixed candidate pool. Enough to
 * exercise the buffer/reroll logic without a live Lavalink node.
 */
function makePlayer(opts: { current?: Track; tracks?: Track[]; pool: Track[] }): Player {
  const store = new Map<string, unknown>();
  const tracks: Track[] = opts.tracks ?? [];
  return {
    guildId: 'g1',
    queue: {
      current: opts.current,
      tracks,
      async add(t: Track | Track[]) {
        if (Array.isArray(t)) tracks.push(...t);
        else tracks.push(t);
      },
      async splice(index: number, amount: number) {
        return tracks.splice(index, amount);
      },
    },
    get<T>(key: string): T | undefined {
      return store.get(key) as T | undefined;
    },
    set(key: string, value: unknown) {
      store.set(key, value);
    },
    async search() {
      return { tracks: opts.pool.slice() };
    },
  } as unknown as Player;
}

test('fillAutoplayBuffer: tops the queue up to the buffer size from the pool', async () => {
  const pool = ['a', 'b', 'c', 'd', 'e', 'f'].map(track);
  const player = makePlayer({ pool });

  const added = await fillAutoplayBuffer(player, track('seed'));

  assert.ok(added >= 1, 'adds at least one track');
  assert.equal(player.queue.tracks.length, added);
  // Default buffer is 5; the pool has 6 → it fills to 5, not all 6.
  assert.equal(player.queue.tracks.length, 5);
  const ids = new Set(player.queue.tracks.map((t) => t.info.identifier));
  assert.equal(ids.size, 5, 'no duplicates queued');
});

test('rerollAutoplay: keeps user-queued tracks, replaces only autoplay ones', async () => {
  const user = track('user-song');
  const auto1 = track('auto1');
  const auto2 = track('auto2');
  const fresh = ['x', 'y', 'z', 'w', 'v'].map(track);

  const player = makePlayer({
    current: track('seed'),
    tracks: [user, auto1, auto2],
    pool: fresh,
  });
  // Mark which upcoming tracks autoplay added.
  player.set('autoplayQueued', ['auto1', 'auto2']);

  const added = await rerollAutoplay(player, player.queue.current!);

  assert.ok(added >= 1, 'queues fresh tracks');
  // The user's song is kept and stays at the front.
  assert.equal(player.queue.tracks[0]?.info.identifier, 'user-song');
  const ids = player.queue.tracks.map((t) => t.info.identifier);
  assert.ok(!ids.includes('auto1') && !ids.includes('auto2'), 'old autoplay picks are gone');
  // The removed autoplay tracks are remembered as "seen" so they aren't re-picked.
  const seen = player.get<string[]>('autoplaySeen') ?? [];
  assert.ok(seen.includes('auto1') && seen.includes('auto2'));
});

test('clearAutoplayQueued: removes autoplay picks, keeps user-queued tracks', async () => {
  const user = track('user-song');
  const auto1 = track('auto1');
  const auto2 = track('auto2');
  const player = makePlayer({ tracks: [user, auto1, auto2], pool: [] });
  player.set('autoplayQueued', ['auto1', 'auto2']);

  const removed = await clearAutoplayQueued(player);

  assert.equal(removed, 2);
  assert.deepEqual(
    player.queue.tracks.map((t) => t.info.identifier),
    ['user-song'],
  );
  assert.deepEqual(player.get<string[]>('autoplayQueued'), []);
});
