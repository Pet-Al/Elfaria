# Load & soak testing

[k6](https://k6.io) harnesses for Elfaria's public stats API, used to validate
the SLOs (../docs/SLO.md) under load and to help tune the autoscaler thresholds.

## Run

```bash
# Point at a running bot with the API enabled (API_ENABLED=true, API_PORT=8080).
BASE_URL=http://localhost:8080 k6 run load/api-load.js     # ramp to peak & back
VUS=50 DURATION=4h BASE_URL=... k6 run load/api-soak.js     # long steady soak
```

Both scripts set **thresholds that mirror the SLOs** (p95 < 1s, errors < 1%), so
a failing run exits non-zero — drop `api-load.js` into CI to gate releases.

- **`api-load.js`** — ramping VUs (0→200→0) across `/api/health`, `/api/stats`,
  `/api/top-tracks`. Validates HTTP/CPU headroom and the latency/error SLOs.
- **`api-soak.js`** — constant moderate load for hours against the heaviest read
  (`/api/top-tracks`). Validates *stability over time*: no memory/lag creep, no
  handle leaks, no replica-lag blow-up. A healthy soak is a flat resource line.

## Validating HPA thresholds

The Lavalink HPA scales on `elfaria_active_players` (external metric) with CPU as
a backstop (`k8s/lavalink-hpa.yaml`, `k8s/monitoring/`). Run a load test, then
watch the autoscaler react:

```bash
kubectl -n elfaria get hpa lavalink -w          # desired/current replicas
kubectl -n elfaria top pods                      # CPU/mem under load
# the exact signal the HPA reads:
kubectl get --raw \
  "/apis/external.metrics.k8s.io/v1beta1/namespaces/elfaria/elfaria_active_players"
```

Confirm: the metric rises under load, the HPA's *desired* replicas step up when
it crosses the target, and scale-down respects the stabilization window after
load drops. Tune `averageValue`/CPU targets in `lavalink-hpa.yaml` until scaling
is neither twitchy nor sluggish.

## Honest scope — what k6 can and can't drive here

This is the **important caveat**. A Discord bot's real load is the **gateway**
(events) and **voice/audio** (Lavalink players) — neither is HTTP, so k6 can't
synthesize them directly:

- ✅ **The public API** is plain HTTP — fully load/soak-testable, and a good
  proxy for the bot process's CPU, event-loop health, and the read-replica path
  (top-tracks hits the same query the recommender/analytics use).
- ⚠️ **The player-count HPA** scales on *real* active players. k6 won't create
  voice sessions, so to exercise that signal you either (a) drive real/synthetic
  playback in a staging guild, or (b) temporarily assert a player count to
  rehearse the scaling reaction. Use the API load test to validate the bot's
  request-path headroom and the SLO thresholds; validate audio scaling with
  actual playback.
- ❌ **Gateway throughput** (commands/sec at the Discord edge) can't be
  load-tested without Discord itself; rely on the per-command RED metrics and
  the SLO burn-rate alerts in production instead.
