import { SlashCommandBuilder } from 'discord.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getPlayer } from '../music/QueueManager.js';

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

    const player = getPlayer(interaction);
    if (!player || player.queue.tracks.length < 2) {
      await replyError(interaction, 'Not enough tracks in the queue to shuffle.');
      return;
    }

    await player.queue.shuffle();
    await replyOk(interaction, `🔀 Shuffled **${player.queue.tracks.length}** tracks.`);
  },
};
