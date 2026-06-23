import assert from 'node:assert/strict';
import test from 'node:test';
import type { Player } from 'lavalink-client';
import { applyLoop, cycleLoop, loopStateOf, settleLoopOnce } from './loop.js';

/** A minimal fake player: repeat mode, a get/set store, and a current track. */
function fakePlayer(currentId = 't1'): Player {
  const store = new Map<string, unknown>();
  const player = {
    repeatMode: 'off',
    queue: { current: { info: { identifier: currentId } } },
    get<T>(key: string): T {
      return store.get(key) as T;
    },
    set(key: string, value: unknown) {
      store.set(key, value);
      return player;
    },
    async setRepeatMode(mode: string) {
      player.repeatMode = mode;
    },
  };
  return player as unknown as Player;
}

test('cycleLoop walks off → track×1 → track∞ → queue×1 → queue∞ → off', async () => {
  const p = fakePlayer();
  assert.equal(loopStateOf(p), 'off');
  assert.equal(await cycleLoop(p), 'track-once');
  assert.equal(p.repeatMode, 'track');
  assert.equal(await cycleLoop(p), 'track');
  assert.equal(await cycleLoop(p), 'queue-once');
  assert.equal(p.repeatMode, 'queue');
  assert.equal(await cycleLoop(p), 'queue');
  assert.equal(await cycleLoop(p), 'off');
  assert.equal(p.repeatMode, 'off');
});

test('track-once arms a marker that settles to off when the track returns', async () => {
  const p = fakePlayer('song-a');
  await applyLoop(p, 'track-once');
  assert.equal(loopStateOf(p), 'track-once');
  assert.equal(p.repeatMode, 'track');

  // A different track starting must NOT disarm it.
  await settleLoopOnce(p, 'song-b');
  assert.equal(loopStateOf(p), 'track-once');

  // Returning to the marked track disarms: looping turns off (one extra play).
  await settleLoopOnce(p, 'song-a');
  assert.equal(p.repeatMode, 'off');
  assert.equal(loopStateOf(p), 'off');
});

test('infinite loop has no one-shot marker', async () => {
  const p = fakePlayer('song-a');
  await applyLoop(p, 'queue');
  await settleLoopOnce(p, 'song-a'); // no marker → stays on
  assert.equal(p.repeatMode, 'queue');
  assert.equal(loopStateOf(p), 'queue');
});
