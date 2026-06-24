import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test, { after, before } from 'node:test';
import { config } from '../config.js';
import { SettingKeys, getBoolSetting } from '../db/appSettings.js';
import { closeDatabase, initDatabase } from '../db/index.js';
import { admin } from './admin.js';
import { help } from './help.js';
import { ping } from './ping.js';
import { status } from './status.js';

/**
 * Command-handler tests with a mocked interaction. These exercise the actual
 * execute() logic — reply content, defer/edit flow, and permission gating —
 * without a live Discord connection, complementing the registry/structure tests.
 * A throwaway DB is initialised so the owner /admin path (which persists toggles)
 * can be exercised end-to-end.
 */
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

interface Captured {
  replies: { content?: string; embeds?: unknown[]; flags?: number }[];
  edits: string[];
  deferred: boolean;
}

/** A minimal ChatInputCommandInteraction stand-in that records what was sent. */
function mockInteraction(opts: {
  userId?: string;
  subcommand?: string;
  stringOptions?: Record<string, string>;
  wsPing?: number;
  guilds?: number;
} = {}) {
  const captured: Captured = { replies: [], edits: [], deferred: false };
  const interaction = {
    user: { id: opts.userId ?? 'user-1' },
    guildId: 'guild-1',
    client: {
      ws: { ping: opts.wsPing ?? 42 },
      guilds: { cache: { size: opts.guilds ?? 0 } },
      lavalink: { players: new Map(), nodeManager: { nodes: new Map() } },
    },
    options: {
      getSubcommand: () => opts.subcommand,
      getString: (name: string, _required?: boolean) => opts.stringOptions?.[name] ?? null,
    },
    deferred: false,
    replied: false,
    async deferReply() {
      this.deferred = true;
      captured.deferred = true;
    },
    async reply(payload: { content?: string; embeds?: unknown[]; flags?: number }) {
      this.replied = true;
      captured.replies.push(payload);
    },
    async editReply(payload: string | { content?: string }) {
      captured.edits.push(typeof payload === 'string' ? payload : (payload.content ?? ''));
    },
  };
  return { interaction, captured };
}

test('ping: defers then edits with a pong', async () => {
  const { interaction, captured } = mockInteraction({ wsPing: 53 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await ping.execute(interaction as any);
  assert.ok(captured.deferred, 'should defer first (3s ack)');
  assert.ok(captured.edits[0]?.includes('Pong'), 'edits with a pong');
  assert.ok(captured.edits[0]?.includes('53ms'));
});

test('help: replies with the grouped command embed', async () => {
  const { interaction, captured } = mockInteraction();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await help.execute(interaction as any);
  const embed = captured.replies[0]?.embeds?.[0] as { data?: { fields?: unknown[] } } | undefined;
  assert.ok(embed, 'replies with an embed');
  assert.ok((embed.data?.fields?.length ?? 0) >= 4, 'has the command groups');
});

test('admin: refuses a non-owner', async () => {
  const { interaction, captured } = mockInteraction({ userId: 'not-the-owner', subcommand: 'status' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await admin.execute(interaction as any);
  assert.ok(captured.replies[0]?.content?.includes('owner-only'), 'rejects non-owner');
});

test('admin: owner can toggle retention off, and it persists', async () => {
  const { interaction, captured } = mockInteraction({
    userId: config.owner.id,
    subcommand: 'retention',
    stringOptions: { state: 'off' },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await admin.execute(interaction as any);
  assert.ok(captured.replies[0]?.content?.includes('OFF'), 'confirms OFF');
  assert.equal(await getBoolSetting(SettingKeys.retentionEnabled, true), false, 'persisted');
});

test('status: replies with a health embed reflecting the guild count', async () => {
  const { interaction, captured } = mockInteraction({ guilds: 7, wsPing: 21 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await status.execute(interaction as any);
  const embed = captured.replies[0]?.embeds?.[0] as { data?: { fields?: { name: string; value: string }[] } };
  const servers = embed?.data?.fields?.find((f) => f.name === 'Servers');
  assert.equal(servers?.value, '7');
});
