import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeShardIds,
  parseOrdinal,
  parseShardList,
  resolveShardAssignment,
} from './shardRange.js';

test('computeShardIds: contiguous slice per pod ordinal', () => {
  // 12 shards, 3 per pod → 4 pods owning disjoint ranges.
  assert.deepEqual(computeShardIds(0, 3, 12), [0, 1, 2]);
  assert.deepEqual(computeShardIds(1, 3, 12), [3, 4, 5]);
  assert.deepEqual(computeShardIds(3, 3, 12), [9, 10, 11]);
});

test('computeShardIds: last pod is clipped to the total (no overshoot)', () => {
  // 10 shards, 3 per pod → pod 3 only gets shard 9.
  assert.deepEqual(computeShardIds(3, 3, 10), [9]);
  // A pod beyond the range gets nothing.
  assert.deepEqual(computeShardIds(4, 3, 10), []);
});

test('computeShardIds: rejects nonsense input', () => {
  assert.deepEqual(computeShardIds(-1, 3, 12), []);
  assert.deepEqual(computeShardIds(0, 0, 12), []);
  assert.deepEqual(computeShardIds(0, 3, 0), []);
});

test('parseOrdinal: from POD_NAME or explicit POD_ORDINAL', () => {
  assert.equal(parseOrdinal('elfaria-bot-2'), 2);
  assert.equal(parseOrdinal('elfaria-bot-10'), 10);
  assert.equal(parseOrdinal(undefined, '5'), 5);
  assert.equal(parseOrdinal('no-ordinal-here-x'), null);
  assert.equal(parseOrdinal(undefined, undefined), null);
});

test('parseShardList: keeps only valid ids within range', () => {
  assert.deepEqual(parseShardList('0,1,2', 4), [0, 1, 2]);
  assert.deepEqual(parseShardList('0, 5, 3', 4), [0, 3]); // 5 is out of range
  assert.deepEqual(parseShardList('x,,1', 4), [1]);
});

test('resolveShardAssignment: null when not in multi-pod mode', () => {
  assert.equal(resolveShardAssignment({}), null);
  assert.equal(resolveShardAssignment({ TOTAL_SHARDS: '0' }), null);
});

test('resolveShardAssignment: derives from ordinal × per-pod', () => {
  const a = resolveShardAssignment({
    TOTAL_SHARDS: '12',
    SHARDS_PER_POD: '3',
    POD_NAME: 'elfaria-bot-1',
  });
  assert.deepEqual(a, { shardIds: [3, 4, 5], totalShards: 12 });
});

test('resolveShardAssignment: explicit SHARD_IDS wins', () => {
  const a = resolveShardAssignment({ TOTAL_SHARDS: '8', SHARD_IDS: '0,2,4' });
  assert.deepEqual(a, { shardIds: [0, 2, 4], totalShards: 8 });
});
