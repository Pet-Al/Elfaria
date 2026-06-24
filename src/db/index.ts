import { logger } from '../lib/logger.js';
import { closeReplica, createDriver, db } from './driver.js';

/**
 * Embedded/durable database (doc §6). The concrete engine — SQLite (default) or
 * Postgres (DATABASE_URL) — is chosen by the driver factory; this module just
 * orchestrates startup/shutdown. Repositories import `db` from ./driver.js.
 */

/** Create the driver and ensure the schema exists. Call once at boot. */
export async function initDatabase(): Promise<void> {
  await createDriver();
  await db.migrate();
  logger.info({ dialect: db.dialect }, 'database initialised');
}

/** Close the connection(s) cleanly on shutdown. */
export async function closeDatabase(): Promise<void> {
  await closeReplica();
  await db.close();
}
