import { ElfariaClient } from './client.js';
import { loadCommands } from './commands/index.js';
import { config } from './config.js';
import { closeDatabase, initDatabase } from './db/index.js';
import { registerEvents } from './events/index.js';
import { logger } from './lib/logger.js';
import { registerLavalinkEvents } from './music/player.js';

/**
 * Entry point (doc §1, milestone 1). Boots the durable, stateful service:
 * database → client → commands → events → Lavalink wiring → login. The Lavalink
 * manager itself is initialised in the ready event (it needs the bot user id).
 * Installs process-level error handlers and graceful shutdown so the bot stays
 * available (doc §10) and a hard crash is left to the supervisor to restart.
 */

const client = new ElfariaClient();

async function main(): Promise<void> {
  await initDatabase();
  loadCommands(client);
  registerEvents(client);
  registerLavalinkEvents(client);

  await client.login(config.discord.token);
}

// ── Reliability (doc §10) ─────────────────────────────────────────────────────

// A rejected promise from, say, a failed track fetch must NOT take the bot down.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled promise rejection');
});

// An uncaught exception leaves the process in an unknown state: log it and exit
// so the supervisor (pm2 / systemd / Docker restart policy) restarts us clean.
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception — exiting for supervisor restart');
  process.exit(1);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'graceful shutdown started');

  // Stop playback and disconnect from all voice channels.
  for (const player of client.lavalink.players.values()) {
    await player.destroy('Bot shutting down').catch((err) => {
      logger.warn({ err, guildId: player.guildId }, 'error destroying player on shutdown');
    });
  }

  try {
    await closeDatabase();
  } catch (err) {
    logger.warn({ err }, 'error while closing database on shutdown');
  }

  await client.destroy();
  logger.info('shutdown complete');
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'fatal error during startup');
  process.exit(1);
});
