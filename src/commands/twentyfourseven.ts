import { SlashCommandBuilder } from 'discord.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getPlayer } from '../music/QueueManager.js';

/**
 * /247 — toggle 24/7 mode: when the queue ends, the bot STAYS in the voice
 * channel instead of leaving, so you can keep adding tracks (or run a lofi
 * stream) without it disconnecting. The flag lives on the player; the queueEnd
 * handler in music/player.ts cancels the queue-empty disconnect when it's on.
 *
 * It deliberately does NOT override the empty-channel rule: if everyone leaves
 * the voice channel, the bot still departs (it won't sit playing to nobody).
 */
export const twentyfourseven: Command = {
  data: new SlashCommandBuilder()
    .setName('247')
    .setDescription('Toggle 24/7 mode (stay in voice when the queue ends).'),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!(await isDj(interaction))) {
      await replyError(interaction, 'You need the DJ role to change 24/7 mode.');
      return;
    }

    const player = getPlayer(interaction);
    if (!player) {
      await replyError(interaction, 'Nothing is playing — start something first, then enable 24/7.');
      return;
    }

    const enabled = !player.get<boolean>('247');
    player.set('247', enabled);
    if (enabled) {
      // Cancel any pending queue-empty disconnect that may already be ticking.
      const pending = player.get<NodeJS.Timeout | undefined>('internal_queueempty');
      if (pending) clearTimeout(pending);
      player.set('internal_queueempty', undefined);
    }

    await replyOk(
      interaction,
      enabled
        ? '♾️ **24/7 mode on** — I’ll stay in the channel when the queue ends (but still leave if everyone does).'
        : '⏹️ **24/7 mode off** — I’ll leave shortly after the queue ends.',
    );
  },
};
