# Monitoring (what it is + autoscaling add-ons)

## The concepts, briefly

The bot exposes a **`/metrics`** endpoint (Prometheus text format) on port 9090 —
a snapshot of numbers like "active players", "commands handled", "resolve
latency" (see `src/lib/metrics.ts`). On its own that's just a page of numbers.
The monitoring stack turns it into something useful:

- **Prometheus** — a time-series database that **scrapes** `/metrics` every few
  seconds and stores the history, so you can ask "how many players over the last
  6 hours?" It also evaluates **alerting rules** (below).
- **Grafana** — a dashboard tool that **queries Prometheus** and draws graphs.
  Import `grafana-dashboard.json` to get charts for players, command rate/latency,
  cache hit ratio, resolve latency, event-loop lag, and memory.
- **Alerts** (`prometheus-alerts.yaml`) — rules Prometheus evaluates continuously;
  when one is true for long enough (e.g. "0 Lavalink nodes for 2 minutes") it
  **fires**, and Alertmanager routes it to Slack/email/PagerDuty. This is how you
  find out something's wrong without watching dashboards.
- **Prometheus Adapter** — republishes a Prometheus metric into Kubernetes'
  metrics API so the **HPA** can autoscale on it (here: active players per node).

You don't need any of this to run the bot — it's for *operating* it at scale.
Everything below is optional and layered on top of a normal deploy.

## Player-count autoscaling

The Lavalink HPA (`../lavalink-hpa.yaml`) scales on **active players per node**,
read from the bot's `elfaria_active_players` gauge. That path needs three pieces,
and this directory wires them up:

```
bot /metrics  ──scrape──▶  Prometheus  ──query──▶  Prometheus Adapter
   (elfaria_active_players)                          (external.metrics.k8s.io)
                                                              │
                                                              ▼
                                                     Lavalink HPA  ──▶ scale pods
                                                     (External metric)
```

1. **The bot already exposes the metric** — `src/lib/metrics.ts` serves
   `elfaria_active_players` on port 9090, and `../bot-service.yaml` makes it
   reachable in-cluster.
2. **`servicemonitor.yaml`** — tells Prometheus (kube-prometheus-stack) to scrape
   it. Set the `release:` label to match your Prometheus.
3. **`prometheus-adapter-values.yaml`** — configures the Prometheus Adapter to
   republish the gauge as the external metric `elfaria_active_players`, which the
   HPA's `type: External` block consumes.

## Install

```bash
# Prometheus + Operator (if you don't already have them):
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack -n monitoring --create-namespace

# The metrics adapter, pointed at that Prometheus:
helm install prometheus-adapter prometheus-community/prometheus-adapter \
  -n monitoring -f k8s/monitoring/prometheus-adapter-values.yaml

# Scrape config for the bot:
kubectl apply -f k8s/monitoring/servicemonitor.yaml
```

## Verify the metric reaches Kubernetes

```bash
# Raw gauge from the bot:
kubectl -n elfaria exec deploy/elfaria-bot -- wget -qO- localhost:9090/metrics | grep elfaria_active_players

# The external metric the HPA reads:
kubectl get --raw "/apis/external.metrics.k8s.io/v1beta1/namespaces/elfaria/elfaria_active_players"

# The HPA should now show the players metric (not just CPU):
kubectl -n elfaria describe hpa lavalink
```

## Dashboard & alerts

- **`grafana-dashboard.json`** — import in Grafana (Dashboards → Import) and pick
  your Prometheus data source. Panels: active players, connected nodes, command
  rate/latency, search-cache hit ratio, resolve latency, event-loop lag, memory.
- **`prometheus-alerts.yaml`** — a `PrometheusRule` (apply with `kubectl apply -f`)
  covering no-Lavalink-nodes, high command error rate, event-loop lag, and slow
  resolves. Set the `release` label to match your Prometheus.

## Until this is installed

The HPA still works — it falls back to CPU. The external metric simply reads
`<unknown>` and Kubernetes scales on CPU alone (holding off on scale-down while a
metric is unknown, which is the safe default). To run CPU-only and silence the
"unknown metric" condition, delete the `External` block from
`../lavalink-hpa.yaml`.
