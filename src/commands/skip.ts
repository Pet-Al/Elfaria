import { SlashCommandBuilder } from 'discord.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getQueue } from '../music/QueueManager.js';

export const skip: Command = {
  data: new SlashCommandBuilder().setName('skip').setDescription('Skip the current track.'),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!isDj(interaction)) {
      await replyError(interaction, 'You need the DJ role to skip.');
      return;
    }

    const queue = getQueue(interaction.guildId!);
    if (!queue || !queue.currentTrack) {
      await replyError(interaction, 'Nothing is playing.');
      return;
    }

    const current = queue.currentTrack;
    queue.node.skip();
    await replyOk(interaction, `⏭️ Skipped **${current.title}**.`);
  },
};
