import { ShardingManager } from 'discord.js';
import { config } from './config.js';
import { logger } from './lib/logger.js';

/**
 * Sharding entrypoint (doc §9).
 *
 * Discord requires sharding once a bot is in ~2,500 guilds (a single gateway
 * connection can't carry more). This launcher spawns one `src/index.ts` process
 * per shard; each is an ordinary bot process with its own LavalinkManager, and
 * discord.js injects the shard id/count via env automatically — so the rest of
 * the code is unchanged. Far below that guild count you do NOT need this; run
 * the bot directly with `npm start`.
 *
 * Usage: `npm run start:sharded` (or set SHARD_COUNT to a fixed number).
 */
/**
 * Resolve a value ShardingManager always accepts: 'auto' or an integer ≥ 1.
 * Guards against the "Amount of shards must be at least 1" crash from a bad
 * SHARD_COUNT (e.g. a stray value, or 'auto' that slipped through Number()).
 * When SHARDING is off, run a single shard so launching this entrypoint by
 * accident (e.g. via the scale compose) still boots instead of erroring.
 */
function resolveTotalShards(): number | 'auto' {
  if (!config.sharding.enabled) return 1;
  const raw = config.sharding.totalShards;
  if (raw === 'auto') return 'auto';
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 'auto';
}

const totalShards = resolveTotalShards();
logger.info({ totalShards, shardingEnabled: config.sharding.enabled }, 'starting sharding manager');

const manager = new ShardingManager('src/index.ts', {
  token: config.discord.token,
  totalShards,
  // Spawn each shard through tsx so the TypeScript entrypoint runs directly.
  execArgv: ['--import', 'tsx'],
  mode: 'process',
});

manager.on('shardCreate', (shard) => {
  logger.info({ shard: shard.id }, 'launched shard');
});

manager.spawn().catch((err) => {
  logger.fatal({ err }, 'failed to spawn shards');
  process.exit(1);
});
