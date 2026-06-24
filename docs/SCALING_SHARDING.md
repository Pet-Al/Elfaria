# Scaling out: multi-pod sharding & progressive deploys

How Elfaria scales the *gateway* tier horizontally, and how to ship new versions
without a full outage. (Audio scales separately — the Lavalink StatefulSet +
HPA; see [`k8s/README.md`](../k8s/README.md).)

## Why a bot can't just "add replicas"

Discord allows **exactly one gateway connection per shard id**. Two processes
connected as shard 3 is an error, not load-balancing. So scaling out means
**partitioning shard ids across pods**, with every pod agreeing on the same
global `shardCount`. There are three modes, in order of scale:

| Mode | When | How |
|------|------|-----|
| **Single process** | < ~2,500 guilds | `npm start` — one process, one shard. The default `bot-deployment.yaml` (replicas: 1, `Recreate`). |
| **One pod, many shards** | hitting the per-shard guild ceiling but one box is fine | `ShardingManager` (`npm run start:sharded`) spawns N shard processes in one pod. |
| **Many pods, shard ranges** | one box isn't enough CPU/RAM | the StatefulSet below — each pod runs a slice of the shards. |

## Multi-pod shard ranges

`k8s/bot-statefulset.yaml` gives each pod a stable ordinal
(`elfaria-bot-0`, `-1`, …). The entrypoint reads three env vars and computes its
own slice (`src/lib/shardRange.ts`):

```
TOTAL_SHARDS    global shard count (every pod must use the same value)
SHARDS_PER_POD  how many shards each pod opens (internal sharding within the pod)
POD_NAME        injected from metadata.name → ordinal
```

Ordinal `o` owns shard ids `[o·perPod … o·perPod + perPod)` clipped to
`TOTAL_SHARDS`. Example — `replicas: 4, SHARDS_PER_POD: 3, TOTAL_SHARDS: 12`:

```
elfaria-bot-0 → shards 0,1,2     elfaria-bot-2 → shards 6,7,8
elfaria-bot-1 → shards 3,4,5     elfaria-bot-3 → shards 9,10,11
```

discord.js opens those shard ids inside the one process and connects them.
**Invariant:** `replicas × SHARDS_PER_POD ≥ TOTAL_SHARDS` (and ideally `==`, so
no pod is empty). To grow, bump `TOTAL_SHARDS` and `replicas` together.

You can also pin shards explicitly with `SHARD_IDS=0,2,4` (overrides the ordinal
maths) — handy for a one-off canary pod.

### What shard 0 owns

Cluster-wide one-shot work runs only on the pod that owns **shard 0**:
- **Global command registration** on boot (`ownsShardZero()` in `events/ready.ts`)
  — so M pods don't each PUT the command set.

## Two scaling gotchas, explained

### 1. Why "doubled" commands happen (and how it's prevented now)

Discord resolves slash commands from **two scopes and MERGES them**: *global*
commands (every server) and *guild* commands (one server). A command registered
in **both** scopes shows up **twice** in the picker — that's the "duplicate
commands" you saw. It's not cosmetic:

- the user sees two identical `/play` entries and can't tell them apart;
- edits to one scope don't touch the other, so the two copies can silently
  **drift** (different descriptions/options);
- it makes the bot look broken.

How you end up with both populated: you register globally (the default), then
also run `deploy:guild` for instant testing — now the same names live in both
scopes. The old boot path made it worse by re-PUTting global **every** restart,
which re-starts Discord's ~1h propagation each time, so during that window the
guild copy and the still-propagating global copy coexisted → dupes.

**The fix** (`reconcileGlobalCommands`, `lib/commandSync.ts`):
1. the global set is re-PUT **only when the definitions actually changed** (a
   hash in `app_settings`), so a normal restart doesn't churn propagation;
2. every boot **always clears the configured guild's copy**, so a leftover
   `deploy:guild` can't coexist with global.

So commands live in exactly **one** scope (global). If you ever orphaned a guild
copy by removing `DISCORD_GUILD_ID`, clear it once with
`npm run deploy -- --clear-guild <id>` (or `npm run deploy:list` to see what's
where). The only unavoidable wait is Discord's **~1 hour** to propagate a *newly
named* command globally — existing commands update quickly.

### 2. The cross-pod presence bug (now fixed)

Under the single-pod `ShardingManager`, the "music in N servers" count is summed
across shards via `client.shard.fetchClientValues` — an IPC that only exists
*within one manager process*. Across **separate pods** there is no such channel,
so each pod could only see `client.guilds.cache.size` for **its own** shards —
and the presence under-counted (e.g. it showed one pod's slice, not the whole
fleet).

**The fix** (`lib/clusterCount.ts`): when `REDIS_URL` is set, every process
publishes its local guild count to a shared Redis hash keyed by its shard range,
with a heartbeat expiry so a dead pod's entry drops out; the presence sums all
the live entries. With no Redis it falls back to the local count (unchanged).
This only affects the cosmetic count — playback and commands were never impacted.

### Cross-pod aggregates (handled)

The "music in N servers" presence is summed correctly across pods when
`REDIS_URL` is set — see [gotcha #2](#2-the-cross-pod-presence-bug-now-fixed)
above. Without Redis it falls back to a per-pod count.

## Progressive deploys (canary → full)

Because you can't have two pods on the same shard, classic "two full
environments" blue-green doesn't apply to the gateway tier — the new pod can
only take a shard once the old one releases it. The StatefulSet gives us the
right tool: **`updateStrategy: RollingUpdate` with a `partition`.**

`partition: N` means *only pods with ordinal ≥ N adopt the new image.* So:

```bash
# 0. Steady state: partition == replicas (4) → an apply changes nothing.

# 1. Canary the highest-ordinal pod (smallest blast radius — one shard range):
kubectl -n elfaria patch statefulset elfaria-bot \
  --type=json -p='[{"op":"replace","path":"/spec/updateStrategy/rollingUpdate/partition","value":3}]'
kubectl -n elfaria set image statefulset/elfaria-bot bot=ghcr.io/pet-al/elfaria:v1.4.0
# → only elfaria-bot-3 restarts on v1.4.0; 0-2 stay on the old version.

# 2. Watch the canary's SLO burn (docs/SLO.md) + logs for ~10-30 min.
kubectl -n elfaria logs -f elfaria-bot-3

# 3a. Healthy → promote the rest, oldest last:
kubectl -n elfaria patch statefulset elfaria-bot \
  --type=json -p='[{"op":"replace","path":"/spec/updateStrategy/rollingUpdate/partition","value":0}]'

# 3b. Bad → roll the canary back (raise the partition above it again):
kubectl -n elfaria patch statefulset elfaria-bot \
  --type=json -p='[{"op":"replace","path":"/spec/updateStrategy/rollingUpdate/partition","value":4}]'
kubectl -n elfaria rollout undo statefulset elfaria-bot
```

This is the bot-appropriate **canary**: a small, fixed fraction of guilds (one
shard range) run the new build first, gated on the same error budget that pages
production. "Blue-green" here is the same mechanism at `partition: 0` vs the full
set — a fast, all-at-once cut once the canary has earned trust.

### Dedicated canary pod (alternative)

For an even more isolated canary, run a separate one-replica StatefulSet with
`SHARD_IDS` set to a single shard and the new image, while the main set covers
the rest. Promote by moving that shard back into the main set. More moving
parts; the partition method above is usually enough.

## Rollout safety checklist

- [ ] `replicas × SHARDS_PER_POD ≥ TOTAL_SHARDS` after any change.
- [ ] `terminationGracePeriodSeconds` ≥ your drain time (voice sessions get a
      moment; see `src/index.ts` graceful shutdown).
- [ ] Canary watched against **command-success & playback burn rate**, not just
      "pod is Running".
- [ ] Bumping `TOTAL_SHARDS` is a coordinated change — it briefly reshuffles
      which guilds map to which shard, so do it in a maintenance window.
