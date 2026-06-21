import { SlashCommandBuilder } from 'discord.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getQueue } from '../music/QueueManager.js';

export const shuffle: Command = {
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Shuffle the upcoming tracks in the queue.'),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!isDj(interaction)) {
      await replyError(interaction, 'You need the DJ role to shuffle.');
      return;
    }

    const queue = getQueue(interaction.guildId!);
    if (!queue || queue.tracks.size < 2) {
      await replyError(interaction, 'Not enough tracks in the queue to shuffle.');
      return;
    }

    queue.tracks.shuffle();
    await replyOk(interaction, `🔀 Shuffled **${queue.tracks.size}** tracks.`);
  },
};
