import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blend } from './blender.js';
import type { Candidate, Signal, SignalName } from './types.js';

const stub = (name: SignalName, weight: number, candidates: Candidate[]): Signal => ({
  name,
  weight,
  candidates: async () => candidates,
});

const c = (uri: string, score: number, source: SignalName): Candidate => ({ uri, score, source });

describe('recsys blender', () => {
  it('fuses weighted scores across signals and dedupes agreed tracks', async () => {
    const collab = stub('collaborative', 1, [c('x', 1, 'collaborative'), c('y', 0.5, 'collaborative')]);
    const session = stub('session', 0.8, [c('x', 1, 'session')]); // x is agreed by two signals
    const out = await blend({ guildId: 'g', limit: 5 }, [collab, session], { epsilon: 0 });
    assert.equal(out[0]!.uri, 'x'); // 1·1 + 0.8·1 = 1.8 beats y's 0.5
    assert.deepEqual([...out[0]!.sources].sort(), ['collaborative', 'session']);
    assert.equal(out.length, 2);
  });

  it('excludes the seed and the exclude set', async () => {
    const collab = stub('collaborative', 1, [
      c('seed', 1, 'collaborative'),
      c('z', 1, 'collaborative'),
      c('skip', 1, 'collaborative'),
    ]);
    const out = await blend(
      { guildId: 'g', seedUri: 'seed', exclude: ['skip'], limit: 5 },
      [collab],
      { epsilon: 0 },
    );
    const uris = out.map((o) => o.uri);
    assert.ok(!uris.includes('seed'));
    assert.ok(!uris.includes('skip'));
    assert.ok(uris.includes('z'));
  });

  it('reserves an exploration slot for the popularity arm', async () => {
    const exploit = stub('collaborative', 1, [
      c('a', 1, 'collaborative'),
      c('b', 0.9, 'collaborative'),
      c('c', 0.8, 'collaborative'),
      c('d', 0.7, 'collaborative'),
    ]);
    const pop = stub('popularity', 0.1, [c('pop', 1, 'popularity')]);
    const out = await blend({ guildId: 'g', limit: 4 }, [exploit, pop], { epsilon: 0.25 });
    assert.equal(out.length, 4);
    // ε·4 = 1 reserved slot → the low-scoring popularity pick is interleaved in,
    // bumping the weakest exploitation pick ('d').
    assert.ok(out.some((o) => o.uri === 'pop'));
    assert.ok(!out.some((o) => o.uri === 'd'));
  });

  it('is fail-soft when a signal throws', async () => {
    const bad: Signal = {
      name: 'session',
      weight: 1,
      candidates: async () => {
        throw new Error('boom');
      },
    };
    const good = stub('collaborative', 1, [c('ok', 1, 'collaborative')]);
    const out = await blend({ guildId: 'g', limit: 5 }, [bad, good], { epsilon: 0 });
    assert.deepEqual(out.map((o) => o.uri), ['ok']);
  });
});
