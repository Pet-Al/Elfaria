import { SlashCommandBuilder } from 'discord.js';
import { setAppSetting } from '../db/appSettings.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { FILTER_CHOICES, applyFilter } from '../music/filters.js';
import { filterKey, getPlayer } from '../music/QueueManager.js';

/**
 * /filter — apply an audio filter / EQ preset (resets any current filter first).
 * Optional `save:true` persists it as this SERVER's default, re-applied to every
 * new player (survives restarts). Presets + apply logic live in music/filters.ts
 * (anti-clipping; includes a "vocal" clarity preset).
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
    )
    .addBooleanOption((opt) =>
      opt
        .setName('save')
        .setDescription('Save as this server’s default (re-applies on every join).'),
    ),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!(await isDj(interaction))) {
      await replyError(interaction, 'You need the DJ role to change filters.');
      return;
    }

    const type = interaction.options.getString('type', true);
    const save = interaction.options.getBoolean('save') ?? false;

    const player = getPlayer(interaction);
    // Saving is allowed without a live player; applying needs one.
    if (player?.queue.current) await applyFilter(player, type);
    else if (!save) {
      await replyError(interaction, 'Nothing is playing.');
      return;
    }

    if (save) await setAppSetting(filterKey(interaction.guildId!), type);

    const base = type === 'off' ? '🎛️ Filters cleared.' : `🎛️ Applied **${type}** filter.`;
    await replyOk(interaction, save ? `${base} Saved as the server default.` : base);
  },
};
