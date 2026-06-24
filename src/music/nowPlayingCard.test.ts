import assert from 'node:assert/strict';
import test from 'node:test';
import type { Track } from 'lavalink-client';
import {
  controlRow,
  endedRow,
  nowPlayingCard,
  progressBar,
  seekSelectRow,
} from './nowPlayingCard.js';

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

test('nowPlayingCard: enriched panel shows badge/state/up-next + volume buttons + loop select', () => {
  const json = nowPlayingCard(track, {
    volume: 80,
    loopState: 'queue',
    upNext: ['Two', 'Three', 'Four', 'Five'],
    queueLength: 5,
  }).toJSON();
  const blob = JSON.stringify(json);
  assert.ok(blob.includes('YouTube'), 'source badge present'); // track.sourceName = youtube
  assert.ok(blob.includes('🔊 80%'), 'volume indicator present');
  assert.ok(blob.includes('Loop: queue'), 'loop indicator present');
  assert.ok(blob.includes('Up next') && blob.includes('+2 more'), 'up-next block present');
  // Five action rows: transport, favorite, loop select, volume select, seek select.
  const rows = json.components.filter((c) => c.type === ACTION_ROW);
  assert.equal(rows.length, 5);
  assert.equal(rows[2]?.components[0]?.type, 3, 'loop is a select menu');
  assert.equal(rows[3]?.components[0]?.type, 3, 'volume is a select menu');
  assert.equal(rows[4]?.components[0]?.type, 3, 'seek is a select menu');
  assert.ok(
    blob.includes('np:volume') &&
      blob.includes('np:favorite') &&
      blob.includes('np:loop') &&
      blob.includes('np:seek'),
  );
});

test('seekSelectRow: 10s steps for a short track, scales for a long one, none for streams', () => {
  // ~3.5min track → 10s steps, capped under 25 options.
  const short = seekSelectRow(track)?.toJSON();
  assert.ok(short, 'a finite-duration track gets a seek control');
  const opts = short.components[0]?.type === 3 ? short.components[0].options : [];
  assert.ok(opts.length > 1 && opts.length <= 25, 'within Discord 25-option limit');
  assert.equal(opts[0]?.value, '0', 'first jump is the start of the track');

  // 2-hour set → coarser steps, still capped under 25 options.
  const longTrack = {
    ...track,
    info: { ...track.info, duration: 2 * 60 * 60 * 1000 },
  } as unknown as Track;
  const long = seekSelectRow(longTrack)?.toJSON();
  const longOpts = long?.components[0]?.type === 3 ? long.components[0].options : [];
  assert.ok(longOpts.length > 1 && longOpts.length <= 25, 'long track still fits the limit');

  // Live stream → no seek control at all.
  const stream = { ...track, info: { ...track.info, isStream: true } } as unknown as Track;
  assert.equal(seekSelectRow(stream), null, 'streams are not seekable');
});

test('nowPlayingCard: accent colour applies', () => {
  const json = nowPlayingCard(track, { accentColor: 0xff0000 }).toJSON();
  assert.equal(json.accent_color, 0xff0000);
});

test('nowPlayingCard: buried panel greys controls and has NO replay', () => {
  const json = nowPlayingCard(track, { disabled: true }).toJSON();
  assert.ok(!JSON.stringify(json).includes('np:replay'), 'a buried panel must not keep an active control');
  assert.equal(json.components.filter((c) => c.type === ACTION_ROW).length, 1, 'only the greyed transport row');
});

test('nowPlayingCard: finished panel greys transport but keeps Replay + Favorite active', () => {
  const json = nowPlayingCard(track, { disabled: true, withReplay: true }).toJSON();
  const blob = JSON.stringify(json);
  assert.ok(blob.includes('np:replay'), 'finished panel has a Replay button');
  assert.ok(blob.includes('np:favorite'), 'finished panel keeps a Favorite button');
  // The only ACTIVE buttons are Replay and Favorite; everything else is greyed.
  const live = new Set(['np:replay', 'np:favorite']);
  const rows = json.components.filter((c) => c.type === ACTION_ROW);
  for (const row of rows) {
    for (const c of row.components) {
      if (c.type !== 2) continue; // buttons only
      const id = 'custom_id' in c ? (c.custom_id as string) : '?';
      const isDisabled = 'disabled' in c && c.disabled === true;
      assert.equal(isDisabled, !live.has(id), `${id} disabled state`);
    }
  }
});

test('endedRow exposes active Replay + Favorite buttons', () => {
  const blob = JSON.stringify(endedRow().toJSON());
  assert.ok(blob.includes('np:replay') && blob.includes('np:favorite'));
});

test('controlRow: has a back button to the left of play', () => {
  const json = controlRow().toJSON();
  const ids = json.components.map((c) => ('custom_id' in c ? c.custom_id : ''));
  assert.deepEqual(ids, ['np:back', 'np:playpause', 'np:skip', 'np:stop', 'np:queue']);
});

test('controlRow: disabled greys out every button', () => {
  const enabled = controlRow(false).toJSON();
  const disabled = controlRow(true).toJSON();
  assert.ok(enabled.components.every((b) => !('disabled' in b && b.disabled)));
  assert.ok(disabled.components.every((b) => 'disabled' in b && b.disabled === true));
});
