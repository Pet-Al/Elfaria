import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { forgetUser } from '../analytics/events.js';
import { logger } from '../lib/logger.js';
import { replyError } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';

/**
 * /forget-me — GDPR right-to-erasure (doc roadmap / PRIVACY.md). Deletes the
 * data tied to the invoking user: their ⭐ favorites, their analytics events,
 * and their attribution on play history. Per-guild settings and shared playlists
 * are not personal data and are unaffected.
 */
export const forgetme: Command = {
  data: new SlashCommandBuilder()
    .setName('forget-me')
    .setDescription('Delete the data Elfaria stores about you (favorites, history, analytics).'),
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await forgetUser(interaction.user.id);
      await interaction.editReply(
        '🧹 Done — your favorites, analytics events, and play-history attribution have been deleted.',
      );
    } catch (err) {
      logger.error({ err, userId: interaction.user.id }, 'forget-me failed');
      await replyError(interaction, 'Something went wrong deleting your data — please try again.');
    }
  },
};
