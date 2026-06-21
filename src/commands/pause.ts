import { SlashCommandBuilder } from 'discord.js';
import { getVoiceContext, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getPlayer } from '../music/QueueManager.js';

export const pause: Command = {
  data: new SlashCommandBuilder().setName('pause').setDescription('Pause the current track.'),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;

    const player = getPlayer(interaction);
    if (!player?.queue.current) {
      await replyError(interaction, 'Nothing is playing.');
      return;
    }
    if (player.paused) {
      await replyError(interaction, 'Playback is already paused.');
      return;
    }

    await player.pause();
    await replyOk(interaction, '⏸️ Paused.');
  },
};
