/**
 * Application cache (doc §7 "application caching").
 *
 * A tiny in-memory TTL cache used for hot paths: resolved track searches and
 * guild settings. It trades a little memory + potential staleness for big wins
 * in latency and reduced load on the DB and external source APIs.
 *
 * At scale (doc §9) this single-process Map is the thing you swap for a shared
 * Redis cache so every shard sees the same data — the interface here is kept
 * deliberately small to make that swap painless.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache {
  private readonly store = new Map<string, Entry<unknown>>();

  constructor(private readonly defaultTtlMs: number = 5 * 60 * 1000) {}

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number = this.defaultTtlMs): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

/** Shared singleton cache for the process. */
export const cache = new TtlCache();
