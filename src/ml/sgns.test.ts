import assert from 'node:assert/strict';
import test from 'node:test';
import { cosine, mostSimilar, trainSgns } from './sgns.js';

/**
 * The point of these tests is to prove the trained model actually LEARNS
 * structure from listening sessions — not just that it runs. We build a corpus
 * with two clear clusters of tracks that only ever co-occur within their own
 * cluster, then assert the embeddings reflect that.
 */

// Two genres that never mix in any session.
const rock = ['rock:a', 'rock:b', 'rock:c', 'rock:d'];
const jazz = ['jazz:a', 'jazz:b', 'jazz:c', 'jazz:d'];

function buildCorpus(): string[][] {
  const sessions: string[][] = [];
  // Many shuffled sessions per cluster so co-occurrence is unambiguous.
  for (let i = 0; i < 60; i++) {
    sessions.push([...rock].sort(() => Math.random() - 0.5));
    sessions.push([...jazz].sort(() => Math.random() - 0.5));
  }
  return sessions;
}

test('trainSgns: learns embeddings for every frequent token', () => {
  const model = trainSgns(buildCorpus(), { minCount: 2, epochs: 8, dim: 32, seed: 7 });
  for (const t of [...rock, ...jazz]) {
    assert.ok(model.vectors.has(t), `missing vector for ${t}`);
    assert.equal(model.vectors.get(t)!.length, 32);
  }
});

test('trainSgns: same-cluster tracks are closer than cross-cluster tracks', () => {
  const model = trainSgns(buildCorpus(), { minCount: 2, epochs: 8, dim: 32, seed: 7 });
  const within = cosine(model.vectors.get('rock:a')!, model.vectors.get('rock:b')!);
  const across = cosine(model.vectors.get('rock:a')!, model.vectors.get('jazz:a')!);
  assert.ok(
    within > across,
    `expected within-cluster (${within.toFixed(3)}) > across-cluster (${across.toFixed(3)})`,
  );
});

test('mostSimilar: a rock seed surfaces rock neighbours first', () => {
  const model = trainSgns(buildCorpus(), { minCount: 2, epochs: 8, dim: 32, seed: 7 });
  const top = mostSimilar(model, 'rock:a', 3).map((r) => r.token);
  assert.ok(top.every((t) => t.startsWith('rock:')), `expected rock neighbours, got ${top}`);
});

test('trainSgns: tiny vocab yields an empty model (no crash)', () => {
  const model = trainSgns([['only', 'one']], { minCount: 5 });
  assert.equal(model.vectors.size, 0);
});
