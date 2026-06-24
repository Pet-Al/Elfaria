import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test, { after, before } from 'node:test';
import { forgetUser } from '../analytics/events.js';
import { coPlayedAfter } from '../analytics/recommend.js';
import { config } from '../config.js';
import { db } from './driver.js';
import { listFavorites, toggleFavorite } from './favorites.js';
import { getGuildSettings, updateGuildSettings } from './guilds.js';
import { countHistory, getHistory, getHistoryPage, getLastPlayed, recordPlay } from './history.js';
import { closeDatabase, initDatabase } from './index.js';
import { deletePlaylist, listPlaylists, loadPlaylistTracks, savePlaylist } from './playlists.js';

// Integration test against a throwaway SQLite database (DATABASE_PATH from
// test/setup.mjs). Each node:test file runs in its own process, so this owns the
// file exclusively.
before(async () => {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(config.database.path + suffix);
    } catch {
      // file may not exist — fine
    }
  }
  await initDatabase();
});
after(async () => {
  await closeDatabase();
});

test('guild settings round-trip (including clearing the DJ role)', async () => {
  await updateGuildSettings('g1', { defaultVolume: 55, djRoleId: 'role-1' });
  let settings = await getGuildSettings('g1');
  assert.equal(settings.defaultVolume, 55);
  assert.equal(settings.djRoleId, 'role-1');

  await updateGuildSettings('g1', { djRoleId: null });
  settings = await getGuildSettings('g1');
  assert.equal(settings.djRoleId, null);
  assert.equal(settings.defaultVolume, 55, 'volume preserved when only clearing the role');
});

test('play history dedupes (newest first) and tracks the last played', async () => {
  await recordPlay('g-hist', { title: 'A', uri: 'u:a', author: 'x' });
  await recordPlay('g-hist', { title: 'B', uri: 'u:b', author: 'y' });
  await recordPlay('g-hist', { title: 'A', uri: 'u:a', author: 'x' });

  assert.deepEqual(
    (await getHistory('g-hist', 5)).map((e) => e.title),
    ['A', 'B'],
  );
  assert.equal((await getLastPlayed('g-hist'))?.title, 'A');
});

test('history pagination: distinct count + per-page slices (newest first)', async () => {
  for (const n of [1, 2, 3, 4, 5]) {
    await recordPlay('g-page', { title: `T${n}`, uri: `u:${n}`, author: 'a' });
  }
  await recordPlay('g-page', { title: 'T1', uri: 'u:1', author: 'a' }); // replay T1 → newest

  assert.equal(await countHistory('g-page'), 5, '5 distinct tracks');
  // T1 was just replayed so it's newest; page 0 (2 per page) is [T1, T5].
  assert.deepEqual(
    (await getHistoryPage('g-page', 0, 2)).map((e) => e.title),
    ['T1', 'T5'],
  );
  assert.deepEqual(
    (await getHistoryPage('g-page', 1, 2)).map((e) => e.title),
    ['T4', 'T3'],
  );
});

test('favorites toggle on/off and list newest-first', async () => {
  assert.equal(await toggleFavorite('u1', { title: 'A', uri: 'u:a' }), 'added');
  assert.equal(await toggleFavorite('u1', { title: 'A', uri: 'u:a' }), 'removed');
  await toggleFavorite('u1', { title: 'B', uri: 'u:b' });
  assert.deepEqual(
    (await listFavorites('u1')).map((f) => f.title),
    ['B'],
  );
});

test('co-play recommender finds what plays after a seed (window-function CF)', async () => {
  const insert = (uri: string, title: string) =>
    db.run('INSERT INTO events (guild_id, event_type, uri, title, author) VALUES (?, ?, ?, ?, ?)', [
      'g-cf',
      'play',
      uri,
      title,
      'x',
    ]);
  // Sequence A→B, C, A→B : B follows A twice, so it should rank first.
  await insert('u:a', 'A');
  await insert('u:b', 'B');
  await insert('u:c', 'C');
  await insert('u:a', 'A');
  await insert('u:b', 'B');

  const recs = await coPlayedAfter('g-cf', 'u:a', 5);
  assert.equal(recs[0]?.uri, 'u:b', 'B is the most co-played track after A');
});

test('forgetUser wipes a user’s favorites + events (GDPR erasure)', async () => {
  await toggleFavorite('u-forget', { title: 'A', uri: 'u:a' });
  await db.run('INSERT INTO events (guild_id, user_id, event_type) VALUES (?, ?, ?)', [
    'g',
    'u-forget',
    'search',
  ]);
  await forgetUser('u-forget');
  assert.equal((await listFavorites('u-forget')).length, 0);
});

test('playlists save / list / load / delete', async () => {
  await savePlaylist('g-pl', 'o1', 'road', [
    { title: 'A', url: 'u:a', duration: '1:00' },
    { title: 'B', url: 'u:b', duration: null },
  ]);

  const list = await listPlaylists('g-pl', 'o1');
  assert.equal(list.length, 1);
  assert.equal(list[0]?.trackCount, 2);

  const tracks = await loadPlaylistTracks('g-pl', 'o1', 'road');
  assert.equal(tracks?.length, 2);
  assert.equal(tracks?.[0]?.title, 'A');

  assert.equal(await deletePlaylist('g-pl', 'o1', 'road'), true);
  assert.equal((await listPlaylists('g-pl', 'o1')).length, 0);
});
