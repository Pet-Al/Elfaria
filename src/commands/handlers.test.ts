import assert from 'node:assert/strict';
import test from 'node:test';
import { admin } from './admin.js';
import { help } from './help.js';
import { ping } from './ping.js';

/**
 * Command-handler tests with a mocked interaction. These exercise the actual
 * execute() logic — reply content, defer/edit flow, and permission gating —
 * without a live Discord connection, complementing the registry/structure tests.
 */

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
} = {}) {
  const captured: Captured = { replies: [], edits: [], deferred: false };
  const interaction = {
    user: { id: opts.userId ?? 'user-1' },
    guildId: 'guild-1',
    client: { ws: { ping: opts.wsPing ?? 42 } },
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
