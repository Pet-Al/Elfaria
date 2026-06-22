import { SlashCommandBuilder } from 'discord.js';
import type { Track } from 'lavalink-client';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getPlayer } from '../music/QueueManager.js';

export const remove: Command = {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a track from the queue by its position.')
    .addIntegerOption((opt) =>
      opt
        .setName('position')
        .setDescription('Position in the queue (see /queue).')
        .setRequired(true)
        .setMinValue(1),
    ),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!(await isDj(interaction))) {
      await replyError(interaction, 'You need the DJ role to remove tracks.');
      return;
    }

    const player = getPlayer(interaction);
    if (!player || player.queue.tracks.length === 0) {
      await replyError(interaction, 'The queue is empty.');
      return;
    }

    const index = interaction.options.getInteger('position', true) - 1;
    const track = (player.queue.tracks as Track[])[index];
    if (!track) {
      await replyError(interaction, `There is no track at position ${index + 1}.`);
      return;
    }

    await player.queue.splice(index, 1);
    await replyOk(interaction, `🗑️ Removed **${track.info.title}** from the queue.`);
  },
};
