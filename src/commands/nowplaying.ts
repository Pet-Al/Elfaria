import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { replyError } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getQueue } from '../music/QueueManager.js';

export const nowplaying: Command = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Show the track currently playing.'),
  async execute(interaction) {
    const q = getQueue(interaction.guildId!);
    if (!q || !q.currentTrack) {
      await replyError(interaction, 'Nothing is playing.');
      return;
    }

    const track = q.currentTrack;
    const progress = q.node.createProgressBar() ?? '';

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎶 Now playing')
      .setDescription(`**[${track.title}](${track.url})**\n\n${progress}`)
      .addFields(
        { name: 'Author', value: track.author || 'Unknown', inline: true },
        {
          name: 'Requested by',
          value: track.requestedBy ? `<@${track.requestedBy.id}>` : 'Unknown',
          inline: true,
        },
      )
      .setThumbnail(track.thumbnail || null);

    await interaction.reply({ embeds: [embed] });
  },
};
