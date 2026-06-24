import { REST, Routes } from 'discord.js';
import { config } from './src/config.js';
import { syncCommands } from './src/lib/commandSync.js';
import { logger } from './src/lib/logger.js';

/**
 * Registers slash-command definitions with Discord's REST API (doc §2).
 *
 * Elfaria is GLOBAL-only — guild-scoped registration was removed because it's the
 * sole cause of doubled commands. The bot also auto-registers on boot (and clears
 * any leftover guild commands) unless AUTO_DEPLOY_COMMANDS is false; this script
 * is for registering WITHOUT booting (e.g. CI/CD) and for diagnostics/cleanup.
 *
 * Flags:
 *   (none)               Register GLOBALLY (propagation can take up to ~1 hour).
 *   --list               Print what's currently registered (global + dev guild).
 *   --clear-guild <id>   Remove ALL commands from one guild (kill leftover dupes).
 */
type RegisteredCommand = { name: string };

async function clearGuild(guildId: string): Promise<void> {
  const rest = new REST().setToken(config.discord.token);
  const existing = (await rest.get(
    Routes.applicationGuildCommands(config.discord.clientId, guildId),
  )) as RegisteredCommand[];
  await rest.put(Routes.applicationGuildCommands(config.discord.clientId, guildId), { body: [] });
  logger.info({ guildId, cleared: existing.length }, 'cleared all commands from guild');
}

async function list(): Promise<void> {
  const rest = new REST().setToken(config.discord.token);
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
      'GUILD commands (these should be empty — Elfaria is global-only)',
    );
    if (guild.length > 0) {
      logger.warn(
        'Found guild-scoped commands — they double the global set. The bot clears ' +
          'these on boot (CLEAR_ALL_GUILD_COMMANDS), or run --clear-guild <id> now.',
      );
    }
  }
}

async function register(): Promise<void> {
  const result = await syncCommands();
  logger.info(
    { count: result.count, clearedGuild: result.cleared },
    'registered GLOBAL commands (propagation can take up to ~1 hour)',
  );
}

const clearGuildIdx = process.argv.indexOf('--clear-guild');
const run = process.argv.includes('--list')
  ? list
  : clearGuildIdx !== -1
    ? () => {
        const id = process.argv[clearGuildIdx + 1];
        if (!id) throw new Error('--clear-guild requires a guild id, e.g. --clear-guild 123456789');
        return clearGuild(id);
      }
    : register;
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
