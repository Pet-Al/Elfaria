import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDuration, parseTimestamp, requesterOf } from './QueueManager.js';

test('formatDuration: m:ss for under an hour', () => {
  assert.equal(formatDuration(0), '0:00'); // zero is 0:00, NOT "live" (that's isStream's job)
  assert.equal(formatDuration(1_000), '0:01');
  assert.equal(formatDuration(65_000), '1:05');
  assert.equal(formatDuration(215_000), '3:35');
});

test('formatDuration: h:mm:ss once past an hour', () => {
  assert.equal(formatDuration(3_600_000), '1:00:00');
  assert.equal(formatDuration(3_661_000), '1:01:01');
});

test('formatDuration: non-finite / negative is "0:00", never "live"', () => {
  assert.equal(formatDuration(Number.NaN), '0:00');
  assert.equal(formatDuration(Number.POSITIVE_INFINITY), '0:00');
  assert.equal(formatDuration(-5), '0:00');
});

test('parseTimestamp: seconds / m:ss / h:mm:ss', () => {
  assert.equal(parseTimestamp('90'), 90_000);
  assert.equal(parseTimestamp('1:30'), 90_000);
  assert.equal(parseTimestamp('1:02:03'), 3_723_000);
  assert.equal(parseTimestamp('0'), 0);
});

test('parseTimestamp: rejects malformed input', () => {
  assert.equal(parseTimestamp('abc'), null);
  assert.equal(parseTimestamp('1:2:3:4'), null);
  assert.equal(parseTimestamp('-5'), null);
  assert.equal(parseTimestamp('1:xx'), null);
});

test('requesterOf keeps only id + username', () => {
  const user = { id: '42', username: 'Alex', email: 'secret@example.com' } as never;
  assert.deepEqual(requesterOf(user), { id: '42', username: 'Alex' });
});
