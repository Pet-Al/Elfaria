import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Track } from 'lavalink-client';
import { replyError } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { formatDuration, getPlayer } from '../music/QueueManager.js';

const PER_PAGE = 10;

export const queue: Command = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current queue.')
    .addIntegerOption((opt) =>
      opt.setName('page').setDescription('Page number to view.').setMinValue(1),
    ),
  async execute(interaction) {
    const player = getPlayer(interaction);
    if (!player || (!player.queue.current && player.queue.tracks.length === 0)) {
      await replyError(interaction, 'The queue is empty.');
      return;
    }

    const tracks = player.queue.tracks as Track[];
    const maxPage = Math.max(1, Math.ceil(tracks.length / PER_PAGE));
    const requested = (interaction.options.getInteger('page') ?? 1) - 1;
    const page = Math.min(Math.max(requested, 0), maxPage - 1);

    const slice = tracks.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
    const lines = slice.map((t, i) => {
      const length = t.info.isStream ? 'live' : formatDuration(t.info.duration);
      return `\`${page * PER_PAGE + i + 1}.\` [${t.info.title}](${t.info.uri}) \`${length}\``;
    });

    const current = player.queue.current;
    const nowPlaying = current
      ? `**Now playing:** [${current.info.title}](${current.info.uri})\n`
      : '';

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎵 Queue')
      .setDescription(`${nowPlaying}\n${lines.length ? lines.join('\n') : '*No upcoming tracks.*'}`)
      .setFooter({
        text: `Page ${page + 1}/${maxPage} • ${tracks.length} in queue • repeat: ${player.repeatMode}`,
      });

    await interaction.reply({ embeds: [embed] });
  },
};
