import 'dotenv/config';
import { resolveShardAssignment } from './lib/shardRange.js';

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
    // Optional Postgres READ REPLICA (doc: docs/DATA.md / roadmap HA). When set
    // to a postgres:// URL, heavy analytics reads (top-tracks, the recommender's
    // co-play + training queries) are routed here instead of the primary, so
    // reporting load doesn't compete with the hot transactional path. The
    // transactional path (settings/favorites/queue) always uses the primary.
    replicaUrl: optional('DATABASE_REPLICA_URL', ''),
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
    // How often the now-playing card re-renders its progress bar (ms). Set to 0
    // to disable live updates entirely — recommended at very large scale, where
    // editing one message per guild every interval would dominate the bot's
    // global API budget.
    nowPlayingRefreshMs: intOption('NOWPLAYING_REFRESH_MS', 15_000),
    // How many tracks autoplay keeps queued ahead (the "autoplay buffer"). When
    // the queue runs dry and autoplay is on, it tops up to this many related
    // tracks instead of just one, so there's always a visible "up next".
    autoplayBuffer: intOption('AUTOPLAY_QUEUE_SIZE', 5),
    // Error-storm backstop: destroy a player only after this many stuck/errored
    // tracks within the window. Deliberately lenient — too tight and a THROTTLED
    // YouTube stream (which stalls repeatedly) wrongly kills the session ("song
    // randomly dies"); individual bad tracks already auto-skip. The real fix for
    // throttling is YouTube OAuth (lavalink/application.yml).
    maxTrackErrors: intOption('MAX_TRACK_ERRORS', 10),
    maxTrackErrorsWindowMs: intOption('MAX_TRACK_ERRORS_WINDOW_MS', 60_000),
  },

  // Audio is offloaded to Lavalink node(s) (doc §3 Option B / §9). The bot
  // forwards voice connection info and sends play commands; Lavalink does the
  // sourcing, transcoding, encryption, and UDP streaming. lavalink-client
  // balances player sessions across all configured nodes.
  lavalink: {
    nodes: parseLavalinkNodes(),
  },

  // Spotify is enabled when the LavaSrc app credentials are present (the bot
  // reads them too, just to know whether to show the "Spotify is off" hint vs.
  // the real error when a Spotify request fails).
  spotify: {
    enabled: optional('SPOTIFY_CLIENT_ID', '') !== '',
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
    // Multi-pod sharding (doc roadmap): each pod owns a coordinated, disjoint
    // shard range. Active when TOTAL_SHARDS is set (+ SHARDS_PER_POD and the
    // StatefulSet's POD_NAME, or an explicit SHARD_IDS). null = single process
    // / the ShardingManager path. See docs/SCALING_SHARDING.md.
    multiPod: resolveShardAssignment(process.env),
  },

  commands: {
    defaultCooldownMs: intOption('DEFAULT_COOLDOWN_MS', 3000),
    // Auto-register slash commands GLOBALLY on boot, so a fresh build/restart
    // never needs a separate `npm run deploy` step (the usual cause of "my
    // commands aren't global / didn't update"). Idempotent. Set
    // AUTO_DEPLOY_COMMANDS=false to manage registration manually (e.g. when you
    // use the instant `npm run deploy:guild` dev path).
    autoDeploy: optional('AUTO_DEPLOY_COMMANDS', 'true') !== 'false',
    // Nuclear de-dupe: when true, on boot the bot clears GUILD-scoped commands
    // from every server it's in, leaving only the global set. Use this once if
    // you have stubborn doubled commands from an old `deploy:guild`, then turn it
    // back off (it costs one API call per guild). Default off.
    clearGuildCommands: optional('CLEAR_ALL_GUILD_COMMANDS', 'false') === 'true',
  },

  // Analytics event pipeline (doc roadmap #3). Events are always written to the
  // DB; if KAFKA_BROKERS is set they're ALSO published to Kafka for a warehouse.
  kafka: {
    brokers: optional('KAFKA_BROKERS', '')
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean),
    topic: optional('KAFKA_TOPIC', 'elfaria.events'),
  },

  // Read-only public stats API + web dashboard (doc roadmap). Off by default;
  // aggregate, no PII. Serves a small HTML dashboard at / when enabled.
  api: {
    enabled: optional('API_ENABLED', 'false') === 'true',
    port: intOption('API_PORT', 8080),
  },

  // End-to-end PLAY canary (doc roadmap). Opt-in: set a DEDICATED staging guild +
  // empty voice channel; the bot periodically joins, plays a known track, checks
  // the position actually advances (real audio), then leaves. DO NOT point this
  // at a channel people use — it will interrupt playback there.
  canary: {
    guildId: optional('CANARY_GUILD_ID', ''),
    voiceChannelId: optional('CANARY_VOICE_CHANNEL_ID', ''),
    textChannelId: optional('CANARY_TEXT_CHANNEL_ID', ''),
    query: optional('CANARY_QUERY', 'ytsearch:lofi'),
  },

  // Bot owner — may use the owner-only /admin toggles (retention, /forget-me).
  // Defaults to the project owner's Discord user id; override with OWNER_ID.
  owner: {
    id: optional('OWNER_ID', '582699270369574912'),
  },

  // GDPR data retention: play_history + events older than this are pruned daily.
  retentionDays: intOption('DATA_RETENTION_DAYS', 90),

  // Trained recommender (doc roadmap #6). The offline trainer (`npm run train`)
  // writes an item2vec embeddings artifact here; the bot loads it on boot and
  // autoplay uses it ahead of the heuristics. Optional — absent = heuristics only.
  recommender: {
    modelPath: optional('RECOMMENDER_MODEL_PATH', './data/recommender.json'),
  },

  // Prometheus metrics (doc §10). On by default on its own port; a scraper hits
  // GET /metrics. Set METRICS_ENABLED=false to turn the endpoint off entirely.
  metrics: {
    enabled: optional('METRICS_ENABLED', 'true') !== 'false',
    port: intOption('METRICS_PORT', 9090),
  },
} as const;

export type Config = typeof config;
