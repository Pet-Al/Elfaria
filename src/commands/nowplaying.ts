import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { replyError } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { formatDuration, getPlayer } from '../music/QueueManager.js';

const BAR_SIZE = 18;

function progressBar(positionMs: number, durationMs: number): string {
  if (!durationMs || durationMs <= 0) return '🔴 LIVE';
  const ratio = Math.min(positionMs / durationMs, 1);
  const filled = Math.round(ratio * BAR_SIZE);
  const bar = '▬'.repeat(filled) + '🔘' + '▬'.repeat(Math.max(BAR_SIZE - filled, 0));
  return `${bar}\n\`${formatDuration(positionMs)} / ${formatDuration(durationMs)}\``;
}

export const nowplaying: Command = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Show the track currently playing.'),
  async execute(interaction) {
    const player = getPlayer(interaction);
    if (!player?.queue.current) {
      await replyError(interaction, 'Nothing is playing.');
      return;
    }

    const track = player.queue.current;
    const requester = track.requester as { id?: string } | undefined;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎶 Now playing')
      .setDescription(
        `**[${track.info.title}](${track.info.uri})**\n\n${progressBar(player.position, track.info.duration)}`,
      )
      .addFields(
        { name: 'Author', value: track.info.author || 'Unknown', inline: true },
        {
          name: 'Requested by',
          value: requester?.id ? `<@${requester.id}>` : 'Unknown',
          inline: true,
        },
      )
      .setThumbnail(track.info.artworkUrl);

    await interaction.reply({ embeds: [embed] });
  },
};
