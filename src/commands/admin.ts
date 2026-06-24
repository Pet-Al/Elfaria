import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { SettingKeys, getBoolSetting, setAppSetting } from '../db/appSettings.js';
import { replyError, replyOk } from '../lib/interactions.js';
import { logger } from '../lib/logger.js';
import type { Command } from '../lib/types.js';

/**
 * /admin — OWNER-ONLY runtime toggles (gated on config.owner.id, set via
 * OWNER_ID). These flip behaviour without a redeploy and persist in app_settings:
 *
 *   /admin retention <on|off>   — the daily 90-day data-retention prune.
 *   /admin forget-me <on|off>   — whether users may run /forget-me at all.
 *   /admin status               — show the current values.
 *
 * Disabling retention means data is kept indefinitely; disabling /forget-me
 * removes users' self-service erasure. Both have privacy implications — they're
 * deliberately owner-only and off-by-keeping-the-safe-default (both ON).
 */
export const admin: Command = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Owner-only bot settings.')
    .addSubcommand((sub) =>
      sub
        .setName('retention')
        .setDescription('Toggle the daily 90-day data-retention deletion.')
        .addStringOption((opt) =>
          opt
            .setName('state')
            .setDescription('on = prune old data daily (default); off = keep forever')
            .setRequired(true)
            .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('forget-me')
        .setDescription('Toggle whether users may run /forget-me.')
        .addStringOption((opt) =>
          opt
            .setName('state')
            .setDescription('on = users can erase their data (default); off = disabled')
            .setRequired(true)
            .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('Show the current owner toggle values.'),
    ),
  async execute(interaction) {
    if (interaction.user.id !== config.owner.id) {
      await replyError(interaction, 'This command is owner-only.');
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'status') {
      const retention = await getBoolSetting(SettingKeys.retentionEnabled, true);
      const forgetMe = await getBoolSetting(SettingKeys.forgetMeEnabled, true);
      await interaction.reply({
        content:
          `🛠️ **Owner settings**\n` +
          `• 90-day retention deletion: **${retention ? 'ON' : 'OFF'}**\n` +
          `• \`/forget-me\` for users: **${forgetMe ? 'ON' : 'OFF'}**`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const on = interaction.options.getString('state', true) === 'on';
    const key = sub === 'retention' ? SettingKeys.retentionEnabled : SettingKeys.forgetMeEnabled;
    try {
      await setAppSetting(key, on ? 'true' : 'false');
    } catch (err) {
      logger.error({ err, key }, 'failed to persist owner toggle');
      await replyError(interaction, 'Failed to save that setting — please try again.');
      return;
    }

    const label =
      sub === 'retention' ? '90-day retention deletion' : '`/forget-me` for users';
    await replyOk(interaction, `✅ ${label} is now **${on ? 'ON' : 'OFF'}**.`);
  },
};
