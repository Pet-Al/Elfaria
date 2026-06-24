import { Collection, Events, MessageFlags } from 'discord.js';
import type { ElfariaClient } from '../client.js';
import { config } from '../config.js';
import { localeOf, t } from '../lib/i18n.js';
import { logger } from '../lib/logger.js';
import { instrumentCommand, instrumentComponent } from '../lib/metrics.js';
import type { BotEvent } from '../lib/types.js';
import { handleButton, handleSelectMenu } from './buttons.js';
import { handleHistoryButton, handleHistorySelect } from './historyComponents.js';
import { handleQueueButton, handleQueueSelect } from './queueComponents.js';

/**
 * The command router (doc §2). A single interactionCreate handler looks up the
 * right command in the client's Collection and runs it. It also:
 *   - enforces per-user command cooldowns (doc §8, "your own rate limiting"),
 *   - dispatches autocomplete (typeahead) requests to the command,
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

    // Autocomplete (typeahead) — fire-and-forget; failures must never throw to
    // the user, and we must always respond within Discord's window.
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) {
        try {
          await command.autocomplete(interaction);
        } catch (err) {
          logger.warn({ err, command: interaction.commandName }, 'autocomplete failed');
        }
      }
      return;
    }

    // Component interactions, routed by custom-id prefix and instrumented the
    // same way commands are (RED metrics), so EVERY client interaction is wrapped.
    //   np:* → now-playing panel · hist:* → history · q:* → queue
    const kind = (id: string) => id.split(':', 1)[0] ?? 'unknown';

    if (interaction.isButton()) {
      try {
        await instrumentComponent(kind(interaction.customId), async () => {
          if (interaction.customId.startsWith('np:')) await handleButton(interaction);
          else if (interaction.customId.startsWith('hist:')) await handleHistoryButton(interaction);
          else if (interaction.customId.startsWith('q:')) await handleQueueButton(interaction);
        });
      } catch (err) {
        logger.warn({ err, customId: interaction.customId }, 'button handler failed');
      }
      return;
    }

    if (interaction.isStringSelectMenu()) {
      try {
        await instrumentComponent(kind(interaction.customId), async () => {
          if (interaction.customId.startsWith('np:')) await handleSelectMenu(interaction);
          else if (interaction.customId.startsWith('hist:')) await handleHistorySelect(interaction);
          else if (interaction.customId.startsWith('q:')) await handleQueueSelect(interaction);
        });
      } catch (err) {
        logger.warn({ err, customId: interaction.customId }, 'select handler failed');
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) {
      logger.warn({ command: interaction.commandName }, 'received unknown command');
      return;
    }

    // User-facing strings are localised to the invoker's Discord language (i18n).
    const locale = localeOf(interaction);

    // Guild-only: every command in this bot operates on a guild voice/text context.
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: `❌ ${t('error.guildOnly', locale)}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const cooldownMs = command.cooldownMs ?? config.commands.defaultCooldownMs;
    const remaining = checkCooldown(client, command.data.name, cooldownMs, interaction.user.id);
    if (remaining > 0) {
      await interaction.reply({
        content: `⏳ ${t('error.cooldown', locale, { seconds: (remaining / 1000).toFixed(1) })}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      // instrumentCommand records RED metrics (rate/errors/duration) and
      // re-throws so the existing error handling below is unchanged.
      await instrumentCommand(command.data.name, () => command.execute(interaction));
    } catch (err) {
      logger.error(
        { err, command: interaction.commandName, guildId: interaction.guildId },
        'command execution failed',
      );
      const content = `❌ ${t('error.generic', locale)}`;
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
