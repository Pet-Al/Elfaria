# Service levels — SLIs, SLOs & error budgets

What "working well enough" means for Elfaria, measured from the metrics we
already export (`src/lib/metrics.ts`), and how we alert on it. Rules live in
[`k8s/monitoring/prometheus-slo-rules.yaml`](../k8s/monitoring/prometheus-slo-rules.yaml).

The philosophy is Google-SRE-standard: pick a small number of **user-facing**
indicators, set a target a little below perfect, and treat the gap (the **error
budget**) as a thing you're *allowed to spend*. We don't page on raw error rate
— we page on **how fast the budget is burning**, so a brief blip is ignored but
a sustained problem wakes someone.

## SLIs (what we measure)

| # | SLI | Definition (from exported metrics) |
|---|-----|------------------------------------|
| 1 | **Command success** | `ok` commands ÷ all handled commands (`elfaria_commands_total{status}`). A request the user typed either worked or it didn't. |
| 2 | **Command latency** | fraction of commands whose handler finished in < 1s (`elfaria_command_duration_seconds_bucket{le="1"}`). |
| 3 | **Playback availability** | fraction of time at least one Lavalink node is connected (`elfaria_lavalink_nodes_connected > 0`). No node = no audio. |
| 4 | **Resolve latency** *(watch-only)* | p95 of `elfaria_source_resolve_seconds`. Surfaced on the dashboard + a simple alert, not yet budgeted. |

These are deliberately **symptoms users feel**, not causes (CPU, memory). Causes
are diagnostics; the dashboard has them, but they don't define the SLO.

## SLOs (the targets) & error budgets

Measured over a **rolling 28-day window**.

| SLO | Target | Error budget | Budget in real terms (28d) |
|-----|--------|--------------|----------------------------|
| Command success | **99.0%** | 1.0% | ~1 in 100 commands may fail |
| Command latency | **95%** < 1s | 5% | 1 in 20 commands may be slow |
| Playback availability | **99.9%** | 0.1% | ~40 min of "no node" per 28d |

Why not 99.99%? Honesty: a single-region bot that depends on Discord's gateway
and a self-hosted Lavalink can't credibly promise four nines, and chasing it
would mean over-provisioning for little user benefit. These targets are
**achievable with the current architecture** and still tight enough to catch
real regressions. Raise them when the HA work (multi-region Postgres, multiple
Lavalink nodes per region) lands — see [ROADMAP.md](./ROADMAP.md).

## Burn-rate alerting (multi-window, multi-burn-rate)

A **burn rate** of `1×` spends the whole budget exactly over the window; `14.4×`
spends 2% of a 28-day budget in a single hour. We alert when a **long** and a
**short** window are *both* over a threshold — the long window confirms it's
real, the short one confirms it's *still happening* (so the alert resolves
quickly once fixed).

| Burn rate | Windows (long + short) | Budget consumed | Action |
|-----------|------------------------|-----------------|--------|
| **14.4×** | 1h + 5m | 2% in 1h | **Page** (critical) |
| **6×** | 6h + 30m | 5% in 6h | **Page** (critical, command) / ticket (playback) |
| **3×** | 1d + 2h | ~10% in 1d | **Ticket** (warning) |

This maps directly to the alerts in `prometheus-slo-rules.yaml`
(`ElfariaCommandBudget*Burn`, `ElfariaPlaybackBudget*Burn`). The recording rules
(`elfaria:command_error:ratio_rate*`, `elfaria:playback_unavailable:ratio_rate*`)
pre-compute the SLI per window so the alerts stay cheap and readable.

## Error-budget policy (what to *do* with it)

The budget isn't just for alerting — it's a release-velocity governor:

- **Budget healthy** (plenty remaining) → ship freely; take risks, run chaos
  experiments ([chaos/](../chaos/)), do the canary rollouts.
- **Budget < 25% remaining** → freeze risky changes; the next deploys are
  reliability work (the thing that's burning it) until the trend reverses.
- **Budget exhausted** → change freeze except rollbacks/fixes; the fast-burn
  page should already have fired. Write a short post-incident note.

## Viewing it

- **Dashboard**: [`k8s/monitoring/grafana-dashboard.json`](../k8s/monitoring/grafana-dashboard.json)
  shows the SLIs (command success %, latency, players/nodes).
- **Remaining budget** (ad-hoc query), command-success example over 28d:

  ```promql
  1 - (
    sum(increase(elfaria_commands_total{status="error"}[28d]))
    / clamp_min(sum(increase(elfaria_commands_total[28d])), 1)
  ) / 0.01
  ```

  `1.0` = full budget, `0` = exhausted, negative = over budget.

## Honest caveats

- SLIs are **per-process** unless your Prometheus aggregates across shards —
  the `sum(...)` in the rules does this correctly once all shards are scraped.
- Playback availability uses a gauge sampled at scrape time, so sub-scrape
  outages can be missed; it's a good proxy, not a synthetic probe. A true
  black-box check (a canary that plays a track end-to-end) is the next step.
- Until there's meaningful command traffic, ratios are dominated by small
  numbers — the `clamp_min(..., 1)` keeps them from dividing by ~0, but treat
  early alerts with a grain of salt.
