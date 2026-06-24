import { SlashCommandBuilder } from 'discord.js';
import { buildHistoryView } from '../events/historyComponents.js';
import { replyError } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';

/**
 * /history — recently played tracks in this server (doc roadmap, "history").
 * Unlimited and paginated: 10 per page with Prev/Next buttons and a jump-to-page
 * dropdown. Read from the play_history log written on every track start.
 */
export const history: Command = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Browse recently played tracks in this server (paged).'),
  async execute(interaction) {
    const view = await buildHistoryView(interaction.guildId!, 0);
    if (!view) {
      await replyError(interaction, 'No play history yet — play something first.');
      return;
    }
    await interaction.reply(view);
  },
};
