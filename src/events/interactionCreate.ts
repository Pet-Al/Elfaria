import { Collection, Events, MessageFlags } from 'discord.js';
import type { ElfariaClient } from '../client.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import type { BotEvent } from '../lib/types.js';

/**
 * The command router (doc §2). A single interactionCreate handler looks up the
 * right command in the client's Collection and runs it. It also:
 *   - enforces per-user command cooldowns (doc §8, "your own rate limiting"),
 *   - never lets a command error crash the process (doc §10) — errors are
 *     logged with context and reported to the user.
 */

/** Returns remaining cooldown in ms (0 if the user may run the command now). */
function checkCooldown(
  client: ElfariaClient,
  commandName: string,
  cooldownMs: number,
  userId: string,
): number {
  if (cooldownMs <= 0) return 0;

  let timestamps = client.cooldowns.get(commandName);
  if (!timestamps) {
    timestamps = new Collection<string, number>();
    client.cooldowns.set(commandName, timestamps);
  }

  const now = Date.now();
  const expiresAt = timestamps.get(userId);
  if (expiresAt && now < expiresAt) {
    return expiresAt - now;
  }

  timestamps.set(userId, now + cooldownMs);
  return 0;
}

export const interactionCreate: BotEvent<Events.InteractionCreate> = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    const client = interaction.client as ElfariaClient;

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) {
      logger.warn({ command: interaction.commandName }, 'received unknown command');
      return;
    }

    // Guild-only: every command in this bot operates on a guild voice/text context.
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: '❌ Elfaria commands can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const cooldownMs = command.cooldownMs ?? config.commands.defaultCooldownMs;
    const remaining = checkCooldown(client, command.data.name, cooldownMs, interaction.user.id);
    if (remaining > 0) {
      await interaction.reply({
        content: `⏳ Slow down — try again in ${(remaining / 1000).toFixed(1)}s.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await command.execute(interaction);
    } catch (err) {
      logger.error(
        { err, command: interaction.commandName, guildId: interaction.guildId },
        'command execution failed',
      );
      const content = '❌ Something went wrong running that command.';
      try {
        if (interaction.deferred) {
          await interaction.editReply({ content });
        } else if (interaction.replied) {
          await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        }
      } catch {
        // The interaction token may have expired; nothing more we can do.
      }
    }
  },
};
