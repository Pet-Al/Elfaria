import 'dotenv/config';

/**
 * Centralised, validated configuration.
 *
 * Why this exists (doc §11 "secrets"): the bot token and other credentials come
 * from environment variables — never hardcoded, never committed. We validate
 * once, at boot, so a misconfiguration fails fast with a clear message instead
 * of surfacing as a cryptic error deep inside the gateway connection.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable "${name}". ` +
        `Copy .env.example to .env and fill it in.`,
    );
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : fallback;
}

function intOption(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable "${name}" must be an integer, got "${raw}".`);
  }
  return parsed;
}

const nodeEnv = optional('NODE_ENV', 'development');

/** One Lavalink node's connection details. */
export interface LavalinkNodeConfig {
  id: string;
  host: string;
  port: number;
  authorization: string;
  secure: boolean;
}

/** The single node from LAVALINK_HOST/PORT/PASSWORD (the default). */
function singleNodeFromEnv(): LavalinkNodeConfig {
  return {
    id: 'main',
    host: optional('LAVALINK_HOST', 'lavalink'),
    port: intOption('LAVALINK_PORT', 2333),
    authorization: optional('LAVALINK_PASSWORD', 'youshallnotpass'),
    secure: optional('LAVALINK_SECURE', 'false') === 'true',
  };
}

/**
 * Build the Lavalink node list (doc §3/§9, "more Lavalink nodes"). Set
 * LAVALINK_NODES to a JSON array for multiple nodes; otherwise fall back to the
 * single node above. An invalid value warns and falls back rather than crashing
 * the bot — one malformed optional var shouldn't take everything down.
 */
function parseLavalinkNodes(): LavalinkNodeConfig[] {
  const raw = process.env.LAVALINK_NODES;
  if (!raw || raw.trim() === '') return [singleNodeFromEnv()];

  try {
    const parsed = JSON.parse(raw) as Partial<LavalinkNodeConfig>[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('expected a non-empty JSON array');
    }
    // Per-node auth is optional: omit it and every node inherits LAVALINK_PASSWORD.
    // This keeps orchestrator configs (e.g. the k8s LAVALINK_NODES) free of the
    // secret — the password comes from one place (the env/Secret) for all nodes.
    const fallbackAuth = optional('LAVALINK_PASSWORD', 'youshallnotpass');
    return parsed.map((n, i) => ({
      id: n.id ?? `node-${i + 1}`,
      host: n.host ?? 'lavalink',
      port: n.port ?? 2333,
      authorization: n.authorization ?? fallbackAuth,
      secure: n.secure ?? false,
    }));
  } catch (err) {
    // config.ts can't import the logger (it would be circular), so use console.
    // eslint-disable-next-line no-console
    console.warn(
      `[config] Ignoring invalid LAVALINK_NODES (${(err as Error).message}); ` +
        'using the single LAVALINK_HOST/PORT node instead.',
    );
    return [singleNodeFromEnv()];
  }
}

const shardingMode = optional('SHARDING', 'off').toLowerCase();

export const config = {
  nodeEnv,
  isProduction: nodeEnv === 'production',

  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    /** When set, slash commands register instantly to this one guild (staging). */
    guildId: optional('DISCORD_GUILD_ID', ''),
  },

  // Durable state (doc §6). SQLite by default (embedded, zero-config). Set
  // DATABASE_URL to a postgres://… connection string to use Postgres instead —
  // the data layer picks the driver automatically.
  database: {
    path: optional('DATABASE_PATH', './data/elfaria.db'),
    url: optional('DATABASE_URL', ''),
  },

  log: {
    level: optional('LOG_LEVEL', 'info'),
  },

  music: {
    defaultVolume: intOption('DEFAULT_VOLUME', 80),
    // How long an empty voice channel waits before the bot leaves (ms).
    leaveOnEmptyMs: intOption('LEAVE_ON_EMPTY_COOLDOWN_MS', 120_000),
    // How long after the queue ends before the bot leaves (ms).
    leaveOnEndMs: intOption('LEAVE_ON_END_COOLDOWN_MS', 120_000),
    // Default search source when a query isn't a link. Lavalink search prefixes:
    // ytsearch | ytmsearch (YouTube Music) | scsearch (SoundCloud) | spsearch …
    searchPlatform: optional('DEFAULT_SEARCH_PLATFORM', 'ytsearch'),
  },

  // Audio is offloaded to Lavalink node(s) (doc §3 Option B / §9). The bot
  // forwards voice connection info and sends play commands; Lavalink does the
  // sourcing, transcoding, encryption, and UDP streaming. lavalink-client
  // balances player sessions across all configured nodes.
  lavalink: {
    nodes: parseLavalinkNodes(),
  },

  // Optional shared cache (doc §7/§9). Empty = in-memory (single process);
  // set REDIS_URL (e.g. redis://redis:6379) to share the search cache across
  // shards/processes.
  redis: {
    url: optional('REDIS_URL', ''),
  },

  // Optional sharding (doc §9). Off by default — a single process is correct
  // until ~2,500 guilds. SHARDING=on|auto runs the bot under ShardingManager
  // (npm run start:sharded); SHARD_COUNT is "auto" or a number.
  sharding: {
    enabled: ['on', 'auto', 'true', '1'].includes(shardingMode),
    totalShards: optional('SHARD_COUNT', 'auto'),
  },

  commands: {
    defaultCooldownMs: intOption('DEFAULT_COOLDOWN_MS', 3000),
  },

  // Prometheus metrics (doc §10). On by default on its own port; a scraper hits
  // GET /metrics. Set METRICS_ENABLED=false to turn the endpoint off entirely.
  metrics: {
    enabled: optional('METRICS_ENABLED', 'true') !== 'false',
    port: intOption('METRICS_PORT', 9090),
  },
} as const;

export type Config = typeof config;
