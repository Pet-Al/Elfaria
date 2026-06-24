import assert from 'node:assert/strict';
import test from 'node:test';
import { candidatePairs, currentLine, parseLrc } from './lyrics.js';

test('parseLrc: parses [mm:ss.xx] timestamps into sorted ms lines', () => {
  const lines = parseLrc('[00:01.00] first\n[00:03.50] second\n[invalid] nope\n[00:02.00] middle');
  assert.deepEqual(
    lines.map((l) => l.text),
    ['first', 'middle', 'second'],
  );
  assert.equal(lines[0]!.t, 1000);
  assert.equal(lines[1]!.t, 2000);
  assert.equal(lines[2]!.t, 3500);
});

test('currentLine: returns the last line reached at a position', () => {
  const lines = parseLrc('[00:00.00] intro\n[00:05.00] verse\n[00:10.00] chorus');
  assert.equal(currentLine(lines, 0), 'intro');
  assert.equal(currentLine(lines, 4999), 'intro');
  assert.equal(currentLine(lines, 5000), 'verse');
  assert.equal(currentLine(lines, 99999), 'chorus');
});

test('candidatePairs: splits "Artist - Title" YouTube names', () => {
  const pairs = candidatePairs('RickAstleyVEVO', 'Rick Astley - Never Gonna Give You Up (Official Video)');
  // First pair uses the raw author + cleaned title; the dash split recovers the artist.
  assert.ok(pairs.some(([a, t]) => a === 'Rick Astley' && t.includes('Never Gonna Give You Up')));
});
