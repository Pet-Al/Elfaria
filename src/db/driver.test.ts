import assert from 'node:assert/strict';
import test from 'node:test';
import { toPg } from './driver.js';

test('toPg: numbers ? placeholders left-to-right', () => {
  assert.equal(
    toPg('INSERT INTO t (a, b) VALUES (?, ?)'),
    'INSERT INTO t (a, b) VALUES ($1, $2)',
  );
});

test('toPg: handles many placeholders and none', () => {
  assert.equal(toPg('SELECT 1'), 'SELECT 1');
  assert.equal(toPg('? ? ? ?'), '$1 $2 $3 $4');
});

test('toPg: upsert with conflict clause keeps ordering', () => {
  const sql =
    'INSERT INTO guild_settings (guild_id, default_volume) VALUES (?, ?) ' +
    'ON CONFLICT (guild_id) DO UPDATE SET default_volume = ?';
  assert.equal(
    toPg(sql),
    'INSERT INTO guild_settings (guild_id, default_volume) VALUES ($1, $2) ' +
      'ON CONFLICT (guild_id) DO UPDATE SET default_volume = $3',
  );
});
