import { REST, Routes } from 'discord.js';
import { config } from './src/config.js';
import { type CommandScope, syncCommands } from './src/lib/commandSync.js';
import { logger } from './src/lib/logger.js';

/**
 * Registers slash-command definitions with Discord's REST API (doc §2).
 *
 * NOTE: the bot ALSO auto-registers on boot (GLOBAL) unless AUTO_DEPLOY_COMMANDS
 * is false — see src/lib/commandSync.ts + src/events/ready.ts. This script is for
 * registering WITHOUT booting (e.g. CI/CD), or for the instant `--guild` dev path.
 * Both share the SAME `syncCommands()` implementation, so they can't drift.
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
 *   --clear-guild <id>   Remove ALL commands from one guild. Use this to kill
 *             duplicates left behind by an old `deploy:guild` after you removed
 *             DISCORD_GUILD_ID from the env (the bot can only auto-clear the
 *             guild it still knows about).
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

async function register(scope: CommandScope): Promise<void> {
  const result = await syncCommands(scope);
  if (result.scope === 'global') {
    logger.info(
      { count: result.count, clearedGuild: result.cleared },
      'registered GLOBAL commands (propagation can take up to ~1 hour)',
    );
  } else {
    logger.info(
      { count: result.count, guildId: config.discord.guildId, clearedGlobal: result.cleared },
      'registered guild commands (instant) and cleared global commands',
    );
    if (result.cleared > 0) {
      logger.warn(
        'Cleared global commands — Discord can take up to ~1 hour to drop them ' +
          'from clients. Restart your Discord app (Ctrl+R) to refresh sooner.',
      );
    }
  }
}

// GLOBAL is the default (commands appear in every server). Pass --guild to
// register instantly to DISCORD_GUILD_ID instead — the fast dev/iteration path.
const clearGuildIdx = process.argv.indexOf('--clear-guild');
const run = process.argv.includes('--list')
  ? list
  : clearGuildIdx !== -1
    ? () => {
        const id = process.argv[clearGuildIdx + 1];
        if (!id) throw new Error('--clear-guild requires a guild id, e.g. --clear-guild 123456789');
        return clearGuild(id);
      }
    : () => register(process.argv.includes('--guild') ? 'guild' : 'global');
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
