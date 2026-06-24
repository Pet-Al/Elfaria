import { config } from '../config.js';
import { logger } from './logger.js';

/**
 * Cross-pod guild count (fixes the multi-pod "sharding bug").
 *
 * THE BUG: under multi-pod sharding each pod runs only its OWN shards, so
 * `client.guilds.cache.size` is just that pod's slice of servers. The single-pod
 * ShardingManager can sum across shards via `fetchClientValues`, but separate
 * pods have no such IPC — so the "music in N servers" presence under-counted
 * (each pod showed only its own portion).
 *
 * THE FIX: when REDIS_URL is set, every process publishes its local guild count
 * to a shared Redis hash (with a heartbeat expiry so a dead pod's count drops
 * out), and the presence sums the live entries. No Redis → it falls back to the
 * local count, exactly as before. Entirely fail-soft.
 */

const HASH = 'elfaria:shard_guilds';
/** A pod's count is ignored after this long without a heartbeat (stale/dead pod). */
const STALE_MS = 90_000;

let clientPromise: Promise<import('ioredis').Redis | null> | null = null;

async function getClient(): Promise<import('ioredis').Redis | null> {
  if (!config.redis.url) return null;
  if (!clientPromise) {
    clientPromise = (async () => {
      const { Redis } = await import('ioredis');
      return new Redis(config.redis.url, { maxRetriesPerRequest: 2, lazyConnect: false });
    })().catch((err) => {
      logger.warn({ err }, 'cluster-count: redis connect failed (presence will use local count)');
      return null;
    });
  }
  return clientPromise;
}

/** Publish THIS process's guild count under its shard key (value = "count:expiry"). */
export async function publishLocalCount(shardKey: string, count: number): Promise<void> {
  const client = await getClient();
  if (!client) return;
  try {
    await client.hset(HASH, shardKey, `${count}:${Date.now() + STALE_MS}`);
  } catch (err) {
    logger.debug({ err }, 'cluster-count: publish failed');
  }
}

/** Sum every live pod's count from Redis; fall back to `localCount` if unavailable. */
export async function clusterGuildCount(localCount: number): Promise<number> {
  const client = await getClient();
  if (!client) return localCount;
  try {
    const all = await client.hgetall(HASH);
    const now = Date.now();
    let sum = 0;
    let any = false;
    for (const value of Object.values(all)) {
      const [countStr, expiryStr] = value.split(':');
      if (Number(expiryStr) < now) continue; // stale pod — ignore
      sum += Number(countStr) || 0;
      any = true;
    }
    return any ? sum : localCount;
  } catch (err) {
    logger.debug({ err }, 'cluster-count: read failed');
    return localCount;
  }
}

/** A stable per-process key: the pod's shard range (multi-pod) or "single". */
export function shardKey(): string {
  return config.sharding.multiPod ? config.sharding.multiPod.shardIds.join('-') : 'single';
}
