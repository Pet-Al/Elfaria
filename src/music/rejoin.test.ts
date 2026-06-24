import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test, { after, before } from 'node:test';
import { config } from '../config.js';
import { listAppSettingsByPrefix } from '../db/appSettings.js';
import { closeDatabase, initDatabase } from '../db/index.js';
import { clear247State, persist247State, set247Lofi } from './rejoin.js';

/** 24/7 auto-rejoin state round-trips through app_settings (the persisted intent). */
before(async () => {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(config.database.path + suffix);
    } catch {
      // fine
    }
  }
  await initDatabase();
});
after(async () => {
  await closeDatabase();
});

async function state(guildId: string) {
  const all = await listAppSettingsByPrefix('247state:');
  const row = all.find((r) => r.key === `247state:${guildId}`);
  return row ? (JSON.parse(row.value) as { v: string; t: string; forever: boolean; lofi?: string }) : undefined;
}

test('24/7 state persists, merges a lofi station, and clears', async () => {
  await persist247State('g-247', { voiceChannelId: 'vc1', textChannelId: 'tc1', forever: true });
  let s = await state('g-247');
  assert.deepEqual(s, { v: 'vc1', t: 'tc1', forever: true });

  // Adding a lofi station preserves the channels.
  await set247Lofi('g-247', 'jfKfPfyJRdk');
  s = await state('g-247');
  assert.equal(s?.lofi, 'jfKfPfyJRdk');
  assert.equal(s?.v, 'vc1');

  // set247Lofi is a no-op when there's no existing 24/7 state.
  await set247Lofi('g-none', 'abc');
  assert.equal(await state('g-none'), undefined);

  await clear247State('g-247');
  assert.equal(await state('g-247'), undefined);
});
