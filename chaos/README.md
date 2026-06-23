# Chaos engineering

Deliberately injecting failures, in a controlled way, to **prove** the
resilience in [../docs/RELIABILITY.md](../docs/RELIABILITY.md) actually holds —
rather than hoping. Each experiment is a hypothesis ("if X fails, the system
does Y"); you inject the fault, watch the metrics, and fix whatever broke.

> Run in **staging only**, during working hours ("game days"), with alerts wired
> and a colleague watching. Every manifest can be aborted with `kubectl delete -f`.

## Prerequisites

- A staging cluster with the stack deployed (`k8s/`).
- **Chaos Mesh** installed: `helm repo add chaos-mesh https://charts.chaos-mesh.org`
  then `helm install chaos-mesh chaos-mesh/chaos-mesh -n chaos-mesh --create-namespace`.
- The monitoring stack (`k8s/monitoring/`) so you can watch the steady-state
  metrics during the experiment.

## The experiments

| File | Fault | Expected result (the hypothesis) |
|---|---|---|
| `pod-kill.yaml` | Kill a Lavalink pod | Sessions on it drop; the bot reconnects; new players route to a surviving node; command error rate stays bounded; the HPA may replace the pod. |
| `network-delay.yaml` | 800ms±400ms latency + 15% loss to Lavalink | The 30s resolve timeout fires and the circuit breaker opens; users get a clean "source unavailable"; no hung commands; no crash. |

## Game-day runbook

1. **Baseline (steady state).** Open the Grafana dashboard. Note `elfaria_active_players`,
   command rate/error rate, and resolve p95. Have music playing in a test guild.
2. **State the hypothesis** for the experiment you're about to run (table above).
3. **Inject** the smallest blast radius first: `kubectl apply -f chaos/pod-kill.yaml`.
4. **Observe** for the duration:
   - Does playback recover? Do new `/play`s work?
   - Do the alerts (`k8s/monitoring/prometheus-alerts.yaml`) fire and then clear?
   - Does the error rate stay within budget, or spike and stay high?
5. **Abort any time:** `kubectl delete -f chaos/<file>.yaml`.
6. **Record the result.** Pass → confidence. Fail → a concrete gap to fix
   (e.g. "skip didn't recover after node loss") *before* it happens for real.
7. **Escalate blast radius** only once smaller experiments pass (one pod →
   network fault → multiple pods → region).

## Next experiments to add

- Kill the **bot** pod (expect: restart, commands resume, no data corruption —
  Postgres is the source of truth).
- **Redis** outage (expect: fall back to in-memory cache, fail-soft).
- **Postgres** outage (expect: the real failure mode to harden — currently no
  persistence; a candidate for a write queue/retry).
- CPU/memory **stress** on Lavalink (expect: the HPA scales out).
