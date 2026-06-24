import { SlashCommandBuilder } from 'discord.js';
import { setAppSetting } from '../db/appSettings.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { FILTER_CHOICES, applyFilter } from '../music/filters.js';
import { filterKey, getPlayer } from '../music/QueueManager.js';

/**
 * /filter-save — persist a filter as this SERVER's default. It's applied to the
 * current player now and re-applied automatically whenever a new player is
 * created (see ensurePlayer), so the filter survives restarts and re-joins.
 * Save "off" to clear the server default.
 */
export const filtersave: Command = {
  data: new SlashCommandBuilder()
    .setName('filter-save')
    .setDescription('Save a filter as this server’s default (persists & re-applies).')
    .addStringOption((opt) =>
      opt
        .setName('type')
        .setDescription('The effect to persist server-wide (off = clear default).')
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

    const type = interaction.options.getString('type', true);
    await setAppSetting(filterKey(interaction.guildId!), type);

    // Apply to the live player too, if there is one.
    const player = getPlayer(interaction);
    if (player) await applyFilter(player, type);

    await replyOk(
      interaction,
      type === 'off'
        ? '🎛️ Cleared this server’s saved filter.'
        : `🎛️ Saved **${type}** as this server’s default filter — it’ll re-apply automatically.`,
    );
  },
};
