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
const totalShards =
  config.sharding.totalShards === 'auto' ? 'auto' : Number(config.sharding.totalShards);

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
