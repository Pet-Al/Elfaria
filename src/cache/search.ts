import type { SearchResult } from 'lavalink-client';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

/**
 * Shared search cache (doc §7/§9).
 *
 * Caches resolved searches so a popular query skips Lavalink/the source API. The
 * backend is chosen at boot: in-memory by default (per process), or Redis when
 * REDIS_URL is set — so every shard/process shares one cache. The interface is
 * deliberately tiny (get/set) and fail-soft: a cache error never breaks a search.
 */

const TTL_MS = 10 * 60 * 1000;

interface Backend {
  get(key: string): Promise<SearchResult | undefined>;
  set(key: string, value: SearchResult): Promise<void>;
}

class MemoryBackend implements Backend {
  private readonly store = new Map<string, { value: SearchResult; expiresAt: number }>();

  async get(key: string): Promise<SearchResult | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Return a deep copy so callers can re-stamp per-request fields safely.
    return JSON.parse(JSON.stringify(entry.value)) as SearchResult;
  }

  async set(key: string, value: SearchResult): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + TTL_MS });
  }
}

class RedisBackend implements Backend {
  private client: import('ioredis').Redis | null = null;
  private readonly ready: Promise<void>;

  constructor(url: string) {
    this.ready = (async () => {
      const { Redis } = await import('ioredis');
      this.client = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
      this.client.on('error', (err) => logger.warn({ err }, 'redis error'));
      logger.info('search cache: using Redis backend');
    })();
  }

  async get(key: string): Promise<SearchResult | undefined> {
    try {
      await this.ready;
      const raw = await this.client?.get(key);
      return raw ? (JSON.parse(raw) as SearchResult) : undefined;
    } catch (err) {
      logger.warn({ err }, 'redis get failed');
      return undefined;
    }
  }

  async set(key: string, value: SearchResult): Promise<void> {
    try {
      await this.ready;
      await this.client?.set(key, JSON.stringify(value), 'PX', TTL_MS);
    } catch (err) {
      logger.warn({ err }, 'redis set failed');
    }
  }
}

const backend: Backend = config.redis.url
  ? new RedisBackend(config.redis.url)
  : new MemoryBackend();

export const searchCache = {
  get: (key: string): Promise<SearchResult | undefined> => backend.get(key),
  set: (key: string, value: SearchResult): Promise<void> => backend.set(key, value),
};
