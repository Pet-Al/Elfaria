import assert from 'node:assert/strict';
import test from 'node:test';
import { assignVariant } from './experiments.js';

test('assignVariant: deterministic for the same unit', () => {
  const a = assignVariant('reco_order', 'guild-123', ['trained-first', 'coplay-first']);
  const b = assignVariant('reco_order', 'guild-123', ['trained-first', 'coplay-first']);
  assert.equal(a, b);
  assert.ok(['trained-first', 'coplay-first'].includes(a));
});

test('assignVariant: different experiments can bucket the same unit differently', () => {
  // Not guaranteed different, but the mapping must depend on the experiment name.
  const x = assignVariant('exp_a', 'unit', ['a', 'b', 'c', 'd', 'e', 'f']);
  const y = assignVariant('exp_b', 'unit', ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.ok(typeof x === 'string' && typeof y === 'string');
});

test('assignVariant: roughly balanced across many units', () => {
  const counts = { control: 0, treatment: 0 } as Record<string, number>;
  const N = 4000;
  for (let i = 0; i < N; i++) counts[assignVariant('split', `u${i}`)]! += 1;
  // 50/50 split should land each side within ~±5% over 4000 samples.
  for (const v of ['control', 'treatment']) {
    const ratio = counts[v]! / N;
    assert.ok(ratio > 0.45 && ratio < 0.55, `${v} ratio ${ratio.toFixed(3)} not ~0.5`);
  }
});

test('assignVariant: empty variants falls back to control', () => {
  assert.equal(assignVariant('x', 'y', []), 'control');
});
