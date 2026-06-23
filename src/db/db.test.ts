import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test, { after, before } from 'node:test';
import { config } from '../config.js';
import { listFavorites, toggleFavorite } from './favorites.js';
import { getGuildSettings, updateGuildSettings } from './guilds.js';
import { getHistory, getLastPlayed, recordPlay } from './history.js';
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

test('favorites toggle on/off and list newest-first', async () => {
  assert.equal(await toggleFavorite('u1', { title: 'A', uri: 'u:a' }), 'added');
  assert.equal(await toggleFavorite('u1', { title: 'A', uri: 'u:a' }), 'removed');
  await toggleFavorite('u1', { title: 'B', uri: 'u:b' });
  assert.deepEqual(
    (await listFavorites('u1')).map((f) => f.title),
    ['B'],
  );
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
