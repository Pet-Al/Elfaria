import { SlashCommandBuilder } from 'discord.js';
import type { RepeatMode } from 'lavalink-client';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getPlayer } from '../music/QueueManager.js';

export const loop: Command = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Set the repeat mode.')
    .addStringOption((opt) =>
      opt
        .setName('mode')
        .setDescription('Repeat mode.')
        .setRequired(true)
        .addChoices(
          { name: 'Off', value: 'off' },
          { name: 'Current track', value: 'track' },
          { name: 'Whole queue', value: 'queue' },
        ),
    ),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!isDj(interaction)) {
      await replyError(interaction, 'You need the DJ role to change the repeat mode.');
      return;
    }

    const player = getPlayer(interaction);
    if (!player) {
      await replyError(interaction, 'Nothing is playing.');
      return;
    }

    const mode = interaction.options.getString('mode', true) as RepeatMode;
    await player.setRepeatMode(mode);
    await replyOk(interaction, `🔁 Repeat mode set to **${mode}**.`);
  },
};
