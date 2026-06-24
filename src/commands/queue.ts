import { SlashCommandBuilder } from 'discord.js';
import { buildQueueView } from '../events/queueComponents.js';
import { replyError } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getPlayer } from '../music/QueueManager.js';

/**
 * /queue — the current queue, paginated (10/page) with Prev/Next buttons and a
 * jump-to-page dropdown. An optional `page` arg jumps straight to a page; the
 * buttons/dropdown then re-render live (events/queueComponents.ts).
 */
export const queue: Command = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current queue (paged).')
    .addIntegerOption((opt) =>
      opt.setName('page').setDescription('Page number to start on.').setMinValue(1),
    ),
  async execute(interaction) {
    const player = getPlayer(interaction);
    if (!player) {
      await replyError(interaction, 'The queue is empty.');
      return;
    }
    const page = (interaction.options.getInteger('page') ?? 1) - 1;
    const view = buildQueueView(player, page);
    if (!view) {
      await replyError(interaction, 'The queue is empty.');
      return;
    }
    await interaction.reply(view);
  },
};
