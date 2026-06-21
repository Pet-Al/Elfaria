import { SlashCommandBuilder } from 'discord.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getPlayer } from '../music/QueueManager.js';

export const stop: Command = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback, clear the queue, and leave the channel.'),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!isDj(interaction)) {
      await replyError(interaction, 'You need the DJ role to stop playback.');
      return;
    }

    const player = getPlayer(interaction);
    if (!player) {
      await replyError(interaction, 'Nothing is playing.');
      return;
    }

    await player.destroy('Stopped by user');
    await replyOk(interaction, '⏹️ Stopped playback and cleared the queue.');
  },
};
