import { SlashCommandBuilder } from 'discord.js';
import { getGuildSettings, updateGuildSettings } from '../db/guilds.js';
import { isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getPlayer } from '../music/QueueManager.js';

/**
 * Sets the playback volume. The chosen level is persisted as the guild's
 * default (doc §6) so it survives restarts and applies to future players, and is
 * applied to the live player immediately if something is playing.
 */
export const volume: Command = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Show or set the playback volume (0–100).')
    .addIntegerOption((opt) =>
      opt.setName('level').setDescription('Volume from 0 to 100.').setMinValue(0).setMaxValue(100),
    ),
  async execute(interaction) {
    const level = interaction.options.getInteger('level');

    if (level === null) {
      const current = (await getGuildSettings(interaction.guildId!)).defaultVolume;
      await replyOk(interaction, `🔊 Current default volume is **${current}%**.`);
      return;
    }

    if (!(await isDj(interaction))) {
      await replyError(interaction, 'You need the DJ role to change the volume.');
      return;
    }

    await updateGuildSettings(interaction.guildId!, { defaultVolume: level });

    const player = getPlayer(interaction);
    if (player) await player.setVolume(level);

    await replyOk(interaction, `🔊 Volume set to **${level}%**.`);
  },
};
