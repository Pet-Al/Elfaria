import { REST, Routes } from 'discord.js';
import { commands } from './src/commands/index.js';
import { config } from './src/config.js';
import { logger } from './src/lib/logger.js';

/**
 * Registers slash-command definitions with Discord's REST API (doc §2).
 *
 * Run this whenever command definitions change — NOT on every boot.
 *
 *   - With DISCORD_GUILD_ID set → registers to that one guild INSTANTLY. Use a
 *     private guild for staging/fast iteration (doc §11).
 *   - Without it → registers GLOBALLY; propagation can take up to ~1 hour.
 */
async function main(): Promise<void> {
  const body = commands.map((command) => command.data.toJSON());
  const rest = new REST().setToken(config.discord.token);

  if (config.discord.guildId) {
    await rest.put(
      Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
      { body },
    );
    logger.info(
      { count: body.length, guildId: config.discord.guildId },
      'registered guild commands (instant)',
    );
  } else {
    await rest.put(Routes.applicationCommands(config.discord.clientId), { body });
    logger.info(
      { count: body.length },
      'registered global commands (propagation can take up to ~1 hour)',
    );
  }
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to register commands');
  process.exit(1);
});
