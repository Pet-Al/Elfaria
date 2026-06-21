import { QueueRepeatMode } from 'discord-player';
import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { replyError } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getQueue } from '../music/QueueManager.js';

const PER_PAGE = 10;

const REPEAT_LABEL: Record<QueueRepeatMode, string> = {
  [QueueRepeatMode.OFF]: 'off',
  [QueueRepeatMode.TRACK]: 'track',
  [QueueRepeatMode.QUEUE]: 'queue',
  [QueueRepeatMode.AUTOPLAY]: 'autoplay',
};

export const queue: Command = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current queue.')
    .addIntegerOption((opt) =>
      opt.setName('page').setDescription('Page number to view.').setMinValue(1),
    ),
  async execute(interaction) {
    const q = getQueue(interaction.guildId!);
    if (!q || (!q.currentTrack && q.tracks.size === 0)) {
      await replyError(interaction, 'The queue is empty.');
      return;
    }

    const tracks = q.tracks.toArray();
    const maxPage = Math.max(1, Math.ceil(tracks.length / PER_PAGE));
    const requested = (interaction.options.getInteger('page') ?? 1) - 1;
    const page = Math.min(Math.max(requested, 0), maxPage - 1);

    const slice = tracks.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
    const lines = slice.map(
      (t, i) => `\`${page * PER_PAGE + i + 1}.\` [${t.title}](${t.url}) \`${t.duration}\``,
    );

    const nowPlaying = q.currentTrack
      ? `**Now playing:** [${q.currentTrack.title}](${q.currentTrack.url})\n`
      : '';

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎵 Queue')
      .setDescription(`${nowPlaying}\n${lines.length ? lines.join('\n') : '*No upcoming tracks.*'}`)
      .setFooter({
        text: `Page ${page + 1}/${maxPage} • ${tracks.length} in queue • repeat: ${REPEAT_LABEL[q.repeatMode]}`,
      });

    await interaction.reply({ embeds: [embed] });
  },
};
