import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDuration, requesterOf } from './QueueManager.js';

test('formatDuration: m:ss for under an hour', () => {
  assert.equal(formatDuration(0), 'live'); // <= 0 is treated as a live stream
  assert.equal(formatDuration(1_000), '0:01');
  assert.equal(formatDuration(65_000), '1:05');
  assert.equal(formatDuration(215_000), '3:35');
});

test('formatDuration: h:mm:ss once past an hour', () => {
  assert.equal(formatDuration(3_600_000), '1:00:00');
  assert.equal(formatDuration(3_661_000), '1:01:01');
});

test('formatDuration: non-finite / negative is "live"', () => {
  assert.equal(formatDuration(Number.NaN), 'live');
  assert.equal(formatDuration(Number.POSITIVE_INFINITY), 'live');
  assert.equal(formatDuration(-5), 'live');
});

test('requesterOf keeps only id + username', () => {
  const user = { id: '42', username: 'Alex', email: 'secret@example.com' } as never;
  assert.deepEqual(requesterOf(user), { id: '42', username: 'Alex' });
});
