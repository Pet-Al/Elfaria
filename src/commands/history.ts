import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getHistory } from '../db/history.js';
import { replyError } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';

/**
 * /history — recently played tracks in this server (doc roadmap, "history").
 * Read from the play_history log written on every track start.
 */
export const history: Command = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Show recently played tracks in this server.')
    .addIntegerOption((opt) =>
      opt
        .setName('count')
        .setDescription('How many to show (1–20, default 10).')
        .setMinValue(1)
        .setMaxValue(20),
    ),
  async execute(interaction) {
    const count = interaction.options.getInteger('count') ?? 10;
    const entries = await getHistory(interaction.guildId!, count);
    if (entries.length === 0) {
      await replyError(interaction, 'No play history yet — play something first.');
      return;
    }

    const lines = entries.map(
      (e, i) => `\`${i + 1}.\` [${e.title}](${e.uri})${e.author ? ` — ${e.author}` : ''}`,
    );
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🕑 Recently played')
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Replay the most recent with /replay' });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
