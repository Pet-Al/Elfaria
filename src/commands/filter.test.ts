import assert from 'node:assert/strict';
import test from 'node:test';
import { EQ_PRESETS, MAX_BOOST } from '../music/filters.js';

/**
 * The "filters are staticky" fix: every EQ preset must keep its boosts small so
 * the summed signal doesn't clip (the cause of the static). These tests lock in
 * the anti-clipping invariant — boosts capped, cuts allowed, 15 valid bands.
 */
test('EQ presets keep boosts within the anti-clipping ceiling', () => {
  for (const [name, eqBands] of Object.entries(EQ_PRESETS)) {
    assert.equal(eqBands.length, 15, `${name} must define all 15 bands`);
    for (const { band, gain } of eqBands) {
      assert.ok(band >= 0 && band <= 14, `${name} band index in range`);
      assert.ok(gain <= MAX_BOOST + 1e-9, `${name} band ${band} boost ${gain} exceeds ${MAX_BOOST}`);
      assert.ok(gain >= -0.25, `${name} band ${band} below Lavalink's -0.25 floor`);
    }
  }
});

test('EQ presets sum to modest net gain (headroom preserved)', () => {
  for (const [name, eqBands] of Object.entries(EQ_PRESETS)) {
    const sum = eqBands.reduce((a, b) => a + b.gain, 0);
    // Net boost across all bands stays well under the level that drives clipping.
    assert.ok(sum <= 0.6, `${name} net gain ${sum.toFixed(2)} too hot`);
  }
});
