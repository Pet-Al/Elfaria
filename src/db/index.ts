import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

/**
 * Embedded database (doc §6).
 *
 * SQLite via better-sqlite3 — a single file inside the app, no separate server,
 * synchronous and fast. It holds the *durable* slice of state that must survive
 * restarts: per-guild settings and saved playlists. Transient playback state
 * (the live queue) lives in memory and is intentionally NOT persisted in v1.
 */

const dbPath = resolve(config.database.path);
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);

// WAL improves concurrency/durability for a long-lived process.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Schema bootstrap. Idempotent CREATE TABLE IF NOT EXISTS statements act as a
 * minimal migration. This MUST run at module-import time (not deferred to a
 * boot function) because the repository modules prepare their statements
 * eagerly at their own import time — the tables have to exist first. For a v1
 * single file this is sufficient; a growing bot would graduate to Drizzle/Prisma
 * migrations (see README).
 */
function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id        TEXT PRIMARY KEY,
      default_volume  INTEGER NOT NULL DEFAULT 80,
      dj_role_id      TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id    TEXT NOT NULL,
      owner_id    TEXT NOT NULL,
      name        TEXT NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE (guild_id, owner_id, name)
    );

    CREATE TABLE IF NOT EXISTS playlist_tracks (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id  INTEGER NOT NULL,
      title        TEXT NOT NULL,
      url          TEXT NOT NULL,
      duration     TEXT,
      position     INTEGER NOT NULL,
      added_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (playlist_id) REFERENCES playlists (id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist
      ON playlist_tracks (playlist_id, position);
  `);
}

// Run migrations immediately so repositories can prepare statements on import.
migrate();

/**
 * Explicit boot step (called from index.ts main()). The schema is already in
 * place by import time; this simply logs readiness in the startup sequence.
 */
export function initDatabase(): void {
  logger.info({ dbPath }, 'database initialised');
}

/** Close cleanly on shutdown so WAL is checkpointed. */
export function closeDatabase(): void {
  db.close();
}
