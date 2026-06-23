import { SlashCommandBuilder } from 'discord.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { type LoopState, applyLoop, loopLabel } from '../music/loop.js';
import { getPlayer } from '../music/QueueManager.js';

export const loop: Command = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Set the repeat mode.')
    .addStringOption((opt) =>
      opt
        .setName('mode')
        .setDescription('How to repeat.')
        .setRequired(true)
        .addChoices(
          { name: 'Off', value: 'off' },
          { name: 'Track — once more', value: 'track-once' },
          { name: 'Track — infinite', value: 'track' },
          { name: 'Queue — one more lap', value: 'queue-once' },
          { name: 'Queue — infinite', value: 'queue' },
        ),
    ),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!(await isDj(interaction))) {
      await replyError(interaction, 'You need the DJ role to change the repeat mode.');
      return;
    }

    const player = getPlayer(interaction);
    if (!player) {
      await replyError(interaction, 'Nothing is playing.');
      return;
    }

    const mode = interaction.options.getString('mode', true) as LoopState;
    await applyLoop(player, mode);
    await replyOk(interaction, mode === 'off' ? '➡️ Loop off.' : `🔁 ${loopLabel(mode)}.`);
  },
};
