import { REST, Routes } from 'discord.js';
import { commands } from './src/commands/index.js';
import { config } from './src/config.js';
import { logger } from './src/lib/logger.js';

/**
 * Registers slash-command definitions with Discord's REST API (doc §2).
 *
 * Run this whenever command definitions change — NOT on every boot.
 *
 *   - With DISCORD_GUILD_ID set → registers to that one guild INSTANTLY, and
 *     CLEARS global commands so you don't get duplicates (a global copy AND a
 *     guild copy of the same command showing twice in the picker).
 *   - Without it → registers GLOBALLY; propagation can take up to ~1 hour.
 *
 * Pass `--list` to print what's currently registered in each scope (handy for
 * diagnosing duplicate commands) without changing anything.
 */
type RegisteredCommand = { name: string };

const rest = new REST().setToken(config.discord.token);

async function list(): Promise<void> {
  const global = (await rest.get(
    Routes.applicationCommands(config.discord.clientId),
  )) as RegisteredCommand[];
  logger.info({ count: global.length, names: global.map((c) => c.name) }, 'GLOBAL commands');

  if (config.discord.guildId) {
    const guild = (await rest.get(
      Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
    )) as RegisteredCommand[];
    logger.info(
      { count: guild.length, guildId: config.discord.guildId, names: guild.map((c) => c.name) },
      'GUILD commands',
    );
  }

  if (global.length > 0 && config.discord.guildId) {
    logger.warn(
      'You have GLOBAL commands AND a guild configured — that is the usual cause ' +
        'of duplicates. Run `npm run deploy` (no --list) to clear the global set.',
    );
  }
}

async function register(): Promise<void> {
  const body = commands.map((command) => command.data.toJSON());

  if (config.discord.guildId) {
    await rest.put(
      Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
      { body },
    );

    // Clear any GLOBAL registrations so commands don't appear twice. Report how
    // many we removed so it's obvious whether duplicates existed.
    const existingGlobal = (await rest.get(
      Routes.applicationCommands(config.discord.clientId),
    )) as RegisteredCommand[];
    await rest.put(Routes.applicationCommands(config.discord.clientId), { body: [] });

    logger.info(
      { count: body.length, guildId: config.discord.guildId, clearedGlobal: existingGlobal.length },
      'registered guild commands (instant) and cleared global commands',
    );
    if (existingGlobal.length > 0) {
      logger.warn(
        'Cleared global commands — Discord can take up to ~1 hour to drop them ' +
          'from clients. Restart your Discord app (Ctrl+R) to refresh sooner.',
      );
    }
  } else {
    await rest.put(Routes.applicationCommands(config.discord.clientId), { body });
    logger.info(
      { count: body.length },
      'registered global commands (propagation can take up to ~1 hour)',
    );
  }
}

const run = process.argv.includes('--list') ? list : register;
run().catch((err) => {
  logger.fatal({ err }, 'command registration failed');
  process.exit(1);
});
