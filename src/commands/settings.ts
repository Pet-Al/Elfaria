import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getGuildSettings, updateGuildSettings } from '../db/guilds.js';
import { replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';

/**
 * Per-guild configuration (doc §6). These settings are persisted to SQLite so
 * they survive restarts. Restricted to members with Manage Server.
 */
export const settings: Command = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Configure Elfaria for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName('view').setDescription('Show the current settings.'))
    .addSubcommand((sub) =>
      sub
        .setName('dj-role')
        .setDescription('Set the DJ role, or omit the role to clear it.')
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Role allowed to control playback.'),
        ),
    ),
  async execute(interaction) {
    const guildId = interaction.guildId!;
    const sub = interaction.options.getSubcommand();

    if (sub === 'view') {
      const current = getGuildSettings(guildId);
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('⚙️ Server settings')
        .addFields(
          { name: 'Default volume', value: `${current.defaultVolume}%`, inline: true },
          {
            name: 'DJ role',
            value: current.djRoleId ? `<@&${current.djRoleId}>` : 'everyone (no restriction)',
            inline: true,
          },
        );
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'dj-role') {
      const role = interaction.options.getRole('role');
      updateGuildSettings(guildId, { djRoleId: role?.id ?? null });
      await replyOk(
        interaction,
        role
          ? `✅ DJ role set to <@&${role.id}>. Only DJs (and managers) can control playback.`
          : '✅ DJ role cleared. Everyone can control playback.',
      );
    }
  },
};
