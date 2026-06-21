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

export const config = {
  nodeEnv,
  isProduction: nodeEnv === 'production',

  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    /** When set, slash commands register instantly to this one guild (staging). */
    guildId: optional('DISCORD_GUILD_ID', ''),
  },

  database: {
    path: optional('DATABASE_PATH', './data/elfaria.db'),
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

  // Audio is offloaded to a Lavalink node (doc §3 Option B). The bot forwards
  // voice connection info to Lavalink and sends play commands over this link;
  // Lavalink does the sourcing, transcoding, encryption, and UDP streaming.
  lavalink: {
    host: optional('LAVALINK_HOST', 'lavalink'),
    port: intOption('LAVALINK_PORT', 2333),
    password: optional('LAVALINK_PASSWORD', 'youshallnotpass'),
    secure: optional('LAVALINK_SECURE', 'false') === 'true',
  },

  commands: {
    defaultCooldownMs: intOption('DEFAULT_COOLDOWN_MS', 3000),
  },
} as const;

export type Config = typeof config;
