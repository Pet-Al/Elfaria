/**
 * Multi-pod shard coordination (doc roadmap, "multi-pod bot sharding").
 *
 * Discord allows exactly ONE gateway connection per shard id, so scaling a bot
 * across pods isn't "more replicas of the same thing" — each pod must own a
 * DISJOINT range of shard ids, and every pod must agree on the same global
 * `shardCount`. We coordinate that with a StatefulSet: each pod has a stable
 * ordinal (pod name `elfaria-bot-2` → ordinal 2), and from `SHARDS_PER_POD` +
 * `TOTAL_SHARDS` derives exactly which shard ids it should run. discord.js then
 * opens those shards inside the one process ("internal sharding").
 *
 * Pure + dependency-free so the range maths is unit-tested.
 */

export interface ShardAssignment {
  /** The shard ids this pod should connect (a contiguous slice). */
  shardIds: number[];
  /** The global shard count shared by every pod. */
  totalShards: number;
}

/** The shard ids a pod owns, given its ordinal, shards-per-pod, and global total. */
export function computeShardIds(ordinal: number, perPod: number, total: number): number[] {
  if (!Number.isInteger(ordinal) || ordinal < 0 || perPod < 1 || total < 1) return [];
  const start = ordinal * perPod;
  const ids: number[] = [];
  for (let i = start; i < start + perPod && i < total; i++) ids.push(i);
  return ids;
}

/** Derive a StatefulSet ordinal from POD_ORDINAL, or a POD_NAME like `elfaria-bot-3`. */
export function parseOrdinal(podName?: string, podOrdinal?: string): number | null {
  if (podOrdinal && /^\d+$/.test(podOrdinal.trim())) return Number(podOrdinal.trim());
  const match = podName?.trim().match(/-(\d+)$/);
  return match ? Number(match[1]) : null;
}

/** Parse an explicit `"0,1,2"` shard-id list, keeping only ids within [0, total). */
export function parseShardList(list: string, total: number): number[] {
  return list
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '') // a trailing comma must not become Number('') === 0
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0 && n < total);
}

/**
 * Resolve this pod's shard assignment from the environment, or `null` when not
 * in multi-pod mode (`TOTAL_SHARDS` unset/0 — i.e. single process or the
 * ShardingManager path). An explicit `SHARD_IDS` list wins; otherwise the pod
 * derives its slice from its ordinal × `SHARDS_PER_POD`.
 */
export function resolveShardAssignment(
  env: Record<string, string | undefined>,
): ShardAssignment | null {
  const total = Number(env.TOTAL_SHARDS);
  if (!Number.isInteger(total) || total < 1) return null;

  if (env.SHARD_IDS && env.SHARD_IDS.trim() !== '') {
    const ids = parseShardList(env.SHARD_IDS, total);
    return ids.length ? { shardIds: ids, totalShards: total } : null;
  }

  const perPod = Number(env.SHARDS_PER_POD ?? '1');
  const ordinal = parseOrdinal(env.POD_NAME, env.POD_ORDINAL);
  if (ordinal === null || !Number.isInteger(perPod) || perPod < 1) return null;

  const ids = computeShardIds(ordinal, perPod, total);
  return ids.length ? { shardIds: ids, totalShards: total } : null;
}
