import { REST, Routes } from 'discord.js';
import { commands } from './src/commands/index.js';
import { config } from './src/config.js';
import { logger } from './src/lib/logger.js';

/**
 * Registers slash-command definitions with Discord's REST API (doc §2).
 *
 * Run this whenever command definitions change — NOT on every boot.
 *
 * DEFAULT (no flag) → GLOBAL registration: commands appear in EVERY server the
 * bot is in (propagation can take up to ~1 hour). It also clears the configured
 * guild's copy so nothing shows twice. This is what most deploys want.
 *
 * Flags:
 *   --guild   Register instantly to DISCORD_GUILD_ID only (and clear global) —
 *             the fast dev/iteration path. Requires DISCORD_GUILD_ID set.
 *   --global  Explicit alias for the default global behaviour.
 *   --list    Print what's currently registered in each scope (handy for
 *             diagnosing duplicates / which guild your commands are in).
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

async function register(forceGlobal: boolean): Promise<void> {
  const body = commands.map((command) => command.data.toJSON());
  const goGlobal = forceGlobal || !config.discord.guildId;

  if (goGlobal) {
    // GLOBAL: available in every server the bot is in (propagation up to ~1h).
    await rest.put(Routes.applicationCommands(config.discord.clientId), { body });

    // Clear the dev-guild copy (if configured) so the same commands don't show
    // twice in that one server.
    let clearedGuild = 0;
    if (config.discord.guildId) {
      const existingGuild = (await rest.get(
        Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
      )) as RegisteredCommand[];
      await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
        { body: [] },
      );
      clearedGuild = existingGuild.length;
    }

    logger.info(
      { count: body.length, clearedGuild },
      'registered GLOBAL commands (propagation can take up to ~1 hour)',
    );
  } else {
    // GUILD: instant in the configured server — the fast dev/iteration path.
    await rest.put(
      Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
      { body },
    );

    // Clear any GLOBAL registrations so commands don't appear twice.
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
  }
}

// GLOBAL is the default (commands appear in every server). Pass --guild to
// register instantly to DISCORD_GUILD_ID instead — the fast dev/iteration path.
const run = process.argv.includes('--list')
  ? list
  : () => register(!process.argv.includes('--guild'));
run()
  .then(() => {
    // One-shot script: force a clean exit. Importing the command modules pulls
    // in the search cache, and when REDIS_URL is set that open connection keeps
    // the event loop alive — so the process would otherwise hang after the work
    // is done (and get killed with SIGINT). The registration already succeeded.
    process.exit(0);
  })
  .catch((err) => {
    logger.fatal({ err }, 'command registration failed');
    process.exit(1);
  });
