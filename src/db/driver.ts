import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

/**
 * Database driver abstraction (doc §6/§9).
 *
 * One async interface, two backends: embedded SQLite (default) and Postgres
 * (when DATABASE_URL is a postgres URL). The repositories speak this interface
 * with `?` placeholders and dialect-agnostic SQL; each driver adapts the rest
 * (placeholder style, RETURNING, schema DDL). This is what lets the store scale
 * from a single file to a shared Postgres without touching command logic.
 */

export interface Queryable {
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<void>;
  /** Insert one row and return its generated integer id. */
  insert(sql: string, params?: unknown[]): Promise<number>;
}

export interface DbDriver extends Queryable {
  readonly dialect: 'sqlite' | 'postgres';
  migrate(): Promise<void>;
  /** Run `fn` in a transaction; all queries via the provided Queryable. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const SQLITE_SCHEMA = `
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
`;

const POSTGRES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id        TEXT PRIMARY KEY,
    default_volume  INTEGER NOT NULL DEFAULT 80,
    dj_role_id      TEXT,
    created_at      BIGINT NOT NULL DEFAULT extract(epoch from now()),
    updated_at      BIGINT NOT NULL DEFAULT extract(epoch from now())
  );
  CREATE TABLE IF NOT EXISTS playlists (
    id          BIGSERIAL PRIMARY KEY,
    guild_id    TEXT NOT NULL,
    owner_id    TEXT NOT NULL,
    name        TEXT NOT NULL,
    created_at  BIGINT NOT NULL DEFAULT extract(epoch from now()),
    UNIQUE (guild_id, owner_id, name)
  );
  CREATE TABLE IF NOT EXISTS playlist_tracks (
    id           BIGSERIAL PRIMARY KEY,
    playlist_id  BIGINT NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    url          TEXT NOT NULL,
    duration     TEXT,
    position     INTEGER NOT NULL,
    added_at     BIGINT NOT NULL DEFAULT extract(epoch from now())
  );
  CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist
    ON playlist_tracks (playlist_id, position);
`;

// ── SQLite (better-sqlite3) ───────────────────────────────────────────────────

class SqliteDriver implements DbDriver {
  readonly dialect = 'sqlite' as const;
  private readonly db: import('better-sqlite3').Database;
  private readonly stmts = new Map<string, import('better-sqlite3').Statement>();

  constructor(
    private readonly Database: typeof import('better-sqlite3'),
    path: string,
  ) {
    const dbPath = resolve(path);
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  private prepare(sql: string): import('better-sqlite3').Statement {
    let stmt = this.stmts.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmts.set(sql, stmt);
    }
    return stmt;
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return this.prepare(sql).get(...params) as T | undefined;
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.prepare(sql).all(...params) as T[];
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    this.prepare(sql).run(...params);
  }

  async insert(sql: string, params: unknown[] = []): Promise<number> {
    const result = this.prepare(sql).run(...params);
    return Number(result.lastInsertRowid);
  }

  async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    this.db.prepare('BEGIN').run();
    try {
      const result = await fn(this);
      this.db.prepare('COMMIT').run();
      return result;
    } catch (err) {
      this.db.prepare('ROLLBACK').run();
      throw err;
    }
  }

  async migrate(): Promise<void> {
    this.db.exec(SQLITE_SCHEMA);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

// ── Postgres (pg) ─────────────────────────────────────────────────────────────

/** Convert `?` placeholders to Postgres `$1, $2, …`. Exported for unit testing. */
export function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

type PgQuery = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

function pgQueryable(query: PgQuery): Queryable {
  return {
    async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
      const { rows } = await query(toPg(sql), params);
      return rows[0] as T | undefined;
    },
    async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const { rows } = await query(toPg(sql), params);
      return rows as T[];
    },
    async run(sql: string, params: unknown[] = []): Promise<void> {
      await query(toPg(sql), params);
    },
    async insert(sql: string, params: unknown[] = []): Promise<number> {
      const { rows } = await query(`${toPg(sql)} RETURNING id`, params);
      return Number((rows[0] as { id: number | string }).id);
    },
  };
}

class PostgresDriver implements DbDriver {
  readonly dialect = 'postgres' as const;
  private readonly queryable: Queryable;

  constructor(private readonly pool: import('pg').Pool) {
    this.queryable = pgQueryable((text, params) => this.pool.query(text, params as unknown[]));
  }

  get<T>(sql: string, params?: unknown[]) {
    return this.queryable.get<T>(sql, params);
  }
  all<T>(sql: string, params?: unknown[]) {
    return this.queryable.all<T>(sql, params);
  }
  run(sql: string, params?: unknown[]) {
    return this.queryable.run(sql, params);
  }
  insert(sql: string, params?: unknown[]) {
    return this.queryable.insert(sql, params);
  }

  async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const scoped = pgQueryable((text, params) => client.query(text, params as unknown[]));
    try {
      await client.query('BEGIN');
      const result = await fn(scoped);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async migrate(): Promise<void> {
    await this.pool.query(POSTGRES_SCHEMA);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

async function build(): Promise<DbDriver> {
  if (config.database.url.startsWith('postgres')) {
    const { Pool, types } = await import('pg');
    // Parse BIGINT (oid 20) as a JS number so ids/counts aren't strings — our
    // values comfortably fit in a safe integer.
    types.setTypeParser(20, (v) => Number.parseInt(v, 10));
    const pool = new Pool({ connectionString: config.database.url });
    logger.info('database: using Postgres');
    return new PostgresDriver(pool);
  }
  const { default: Database } = await import('better-sqlite3');
  logger.info({ path: config.database.path }, 'database: using SQLite');
  return new SqliteDriver(Database, config.database.path);
}

/** The active driver. Created once at startup by initDatabase(). */
export let db: DbDriver;

export async function createDriver(): Promise<DbDriver> {
  db = await build();
  return db;
}
