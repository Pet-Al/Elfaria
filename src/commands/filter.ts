import { SlashCommandBuilder } from 'discord.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { FILTER_CHOICES, applyFilter } from '../music/filters.js';
import { getPlayer } from '../music/QueueManager.js';

/**
 * /filter — apply an audio filter / EQ preset to THIS session (resets any
 * current filter first). For a server-wide default that survives restarts, use
 * /filter-save. Presets + apply logic live in music/filters.ts (anti-clipping).
 */
export const filter: Command = {
  data: new SlashCommandBuilder()
    .setName('filter')
    .setDescription('Apply an audio filter / equalizer preset.')
    .addStringOption((opt) =>
      opt
        .setName('type')
        .setDescription('The effect to apply (replaces any current filter).')
        .setRequired(true)
        .addChoices(...FILTER_CHOICES),
    ),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!(await isDj(interaction))) {
      await replyError(interaction, 'You need the DJ role to change filters.');
      return;
    }

    const player = getPlayer(interaction);
    if (!player?.queue.current) {
      await replyError(interaction, 'Nothing is playing.');
      return;
    }

    const type = interaction.options.getString('type', true);
    await applyFilter(player, type);
    await replyOk(
      interaction,
      type === 'off' ? '🎛️ Filters cleared.' : `🎛️ Applied **${type}** filter.`,
    );
  },
};
