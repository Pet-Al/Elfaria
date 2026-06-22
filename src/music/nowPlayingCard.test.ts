import assert from 'node:assert/strict';
import test from 'node:test';
import type { Track } from 'lavalink-client';
import { controlRow, nowPlayingCard, progressBar } from './nowPlayingCard.js';

const track = {
  info: {
    title: 'Sunrise Underwater',
    uri: 'https://youtu.be/abc',
    author: 'Mashbit',
    duration: 215_000,
    isStream: false,
    artworkUrl: 'https://img/abc.jpg',
  },
  requester: { id: '123', username: 'Alex' },
} as unknown as Track;

// Component type numbers from the Discord API.
const ACTION_ROW = 1;
const SECTION = 9;
const TEXT_DISPLAY = 10;
const CONTAINER = 17;

function flatten(json: ReturnType<typeof nowPlayingCard.prototype.toJSON>): string {
  return JSON.stringify(json);
}

test('progressBar: marker reflects position', () => {
  assert.equal(progressBar(0, 0), '🔴 LIVE');
  assert.ok(progressBar(0, 100_000).startsWith('🔘'));
  assert.ok(progressBar(100_000, 100_000).endsWith('`1:40 / 1:40`'));
});

test('nowPlayingCard: is a container with artwork as a section thumbnail', () => {
  const json = nowPlayingCard(track).toJSON();
  assert.equal(json.type, CONTAINER);
  const types = json.components.map((c) => c.type);
  assert.ok(types.includes(SECTION), 'artwork should be a compact thumbnail accessory in a section');
  assert.ok(types.includes(ACTION_ROW), 'controls should be present by default');
});

test('nowPlayingCard: duration appears exactly once (auto-panel vs live)', () => {
  // Auto-panel (no progress): duration shown inline once, no progress bar.
  const auto = flatten(nowPlayingCard(track).toJSON());
  assert.equal(auto.split('3:35').length - 1, 1);

  // Live view: duration lives only in the progress bar (position / duration).
  const live = flatten(nowPlayingCard(track, { positionMs: 60_000 }).toJSON());
  assert.equal(live.split('3:35').length - 1, 1);
  assert.ok(live.includes('1:00 / 3:35'));
});

test('nowPlayingCard: withControls=false drops the action row', () => {
  const json = nowPlayingCard(track, { withControls: false }).toJSON();
  assert.ok(!json.components.some((c) => c.type === ACTION_ROW));
});

test('nowPlayingCard: missing artwork omits the section thumbnail', () => {
  const noArt = { ...track, info: { ...track.info, artworkUrl: null } } as unknown as Track;
  const json = nowPlayingCard(noArt).toJSON();
  assert.ok(!json.components.some((c) => c.type === SECTION));
  assert.ok(json.components.some((c) => c.type === TEXT_DISPLAY));
});

test('controlRow: disabled greys out every button', () => {
  const enabled = controlRow(false).toJSON();
  const disabled = controlRow(true).toJSON();
  assert.ok(enabled.components.every((b) => !('disabled' in b && b.disabled)));
  assert.ok(disabled.components.every((b) => 'disabled' in b && b.disabled === true));
});
