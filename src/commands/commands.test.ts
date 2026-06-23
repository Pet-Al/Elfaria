import assert from 'node:assert/strict';
import test from 'node:test';
import { commands } from './index.js';

test('command names are unique', () => {
  const names = commands.map((c) => c.data.name);
  assert.equal(new Set(names).size, names.length, 'duplicate command name');
});

test('every command has a valid definition and an execute handler', () => {
  for (const command of commands) {
    assert.ok(command.data.name.length > 0 && command.data.name.length <= 32, command.data.name);
    assert.equal(typeof command.execute, 'function', `${command.data.name} missing execute`);
    assert.doesNotThrow(() => command.data.toJSON(), `${command.data.name} builds invalid JSON`);
  }
});
