import assert from 'node:assert/strict';
import test from 'node:test';
import type { Track } from 'lavalink-client';
import { controlRow, nowPlayingCard, progressBar, replayRow } from './nowPlayingCard.js';

const track = {
  info: {
    title: 'Sunrise Underwater',
    uri: 'https://youtu.be/abc',
    author: 'Mashbit',
    duration: 215_000,
    isStream: false,
    artworkUrl: 'https://img/abc.jpg',
    sourceName: 'youtube',
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

test('nowPlayingCard: enriched panel shows source badge, state, up-next, volume select', () => {
  const json = nowPlayingCard(track, {
    withVolumeSelect: true,
    volume: 80,
    repeatMode: 'queue',
    upNext: ['Two', 'Three', 'Four', 'Five'],
    queueLength: 5,
  }).toJSON();
  const blob = JSON.stringify(json);
  assert.ok(blob.includes('YouTube'), 'source badge present'); // track.sourceName = youtube
  assert.ok(blob.includes('🔊 80%'), 'volume indicator present');
  assert.ok(blob.includes('Loop: queue'), 'loop indicator present');
  assert.ok(blob.includes('Up next') && blob.includes('+2 more'), 'up-next block present');
  // Two action rows: buttons + the np:volume select (component type 3).
  const rows = json.components.filter((c) => c.type === ACTION_ROW);
  assert.equal(rows.length, 2);
  assert.equal(rows[1]?.components[0]?.type, 3);
});

test('nowPlayingCard: accent colour + favorite button row', () => {
  const json = nowPlayingCard(track, {
    withVolumeSelect: true,
    withFavorite: true,
    accentColor: 0xff0000,
  }).toJSON();
  assert.equal(json.accent_color, 0xff0000);
  // transport + favorite + volume = 3 action rows.
  assert.equal(json.components.filter((c) => c.type === ACTION_ROW).length, 3);
  assert.ok(JSON.stringify(json).includes('np:favorite'), 'favorite button present');
});

test('replayRow exposes the np:replay button', () => {
  assert.ok(JSON.stringify(replayRow().toJSON()).includes('np:replay'));
});

test('controlRow: disabled greys out every button', () => {
  const enabled = controlRow(false).toJSON();
  const disabled = controlRow(true).toJSON();
  assert.ok(enabled.components.every((b) => !('disabled' in b && b.disabled)));
  assert.ok(disabled.components.every((b) => 'disabled' in b && b.disabled === true));
});
