import { SlashCommandBuilder } from 'discord.js';
import { getVoiceContext, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getQueue } from '../music/QueueManager.js';

export const pause: Command = {
  data: new SlashCommandBuilder().setName('pause').setDescription('Pause the current track.'),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;

    const queue = getQueue(interaction.guildId!);
    if (!queue || !queue.currentTrack) {
      await replyError(interaction, 'Nothing is playing.');
      return;
    }
    if (queue.node.isPaused()) {
      await replyError(interaction, 'Playback is already paused.');
      return;
    }

    queue.node.pause();
    await replyOk(interaction, '⏸️ Paused.');
  },
};
