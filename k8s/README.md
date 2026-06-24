# Elfaria on Kubernetes — dynamic Lavalink scaling

This directory deploys Elfaria with a Lavalink audio tier that **autoscales with
demand**. It's the production-grade version of the `docker-compose.scale.yml`
story: instead of a fixed two-node pool, the number of Lavalink pods grows and
shrinks automatically under a HorizontalPodAutoscaler.

## Architecture

```
                    ┌─────────────────────────────┐
   Discord  ◄──────►│   elfaria-bot (Deployment)   │   gateway + command logic
                    │   stateless, 1 replica       │   (Discord sharding handled
                    └──────────────┬──────────────┘    in-process if enabled)
                                   │ one lavalink-client node per pod ordinal
                                   │ (balances player sessions across live pods)
         ┌─────────────────────────┼─────────────────────────┐
         ▼                         ▼                         ▼
  ┌─────────────┐          ┌─────────────┐          ┌─────────────┐
  │ lavalink-0  │          │ lavalink-1  │   ...    │ lavalink-N  │   StatefulSet
  │  (pod)      │          │  (pod)      │          │  (pod)      │   + HPA (CPU)
  └─────────────┘          └─────────────┘          └─────────────┘
   stable DNS: lavalink-{ordinal}.lavalink-hl.elfaria.svc.cluster.local

  ┌─────────────┐   shared search cache      ┌─────────────┐   durable state
  │   redis     │◄───────(all shards)        │  postgres   │◄──(settings/playlists)
  └─────────────┘                            └─────────────┘   StatefulSet + PVC
```

The audio tier is **horizontally scalable** because Lavalink work (transcoding,
streaming) is per-player and CPU-bound — exactly the kind of load an HPA handles
well. The bot, gateway, and data tiers are deliberately *not* autoscaled (see
"Honest caveats").

**Scaling the gateway tier:** the default `bot-deployment.yaml` is one process
(correct below ~2,500 guilds). To run the bot across multiple pods with
coordinated shard ranges — plus a canary/partition rollout playbook — use
`bot-statefulset.yaml` instead and follow
[`../docs/SCALING_SHARDING.md`](../docs/SCALING_SHARDING.md).

## How the dynamic scaling actually works

1. **Stable identities.** Lavalink runs as a `StatefulSet` behind a *headless*
   Service (`clusterIP: None`). That gives each pod a fixed DNS name —
   `lavalink-0.lavalink-hl…`, `lavalink-1.lavalink-hl…` — instead of hiding them
   behind one virtual IP.
2. **Pre-declared nodes.** The bot's `LAVALINK_NODES` lists one entry per pod
   ordinal, sized to the HPA's `maxReplicas`. `lavalink-client` retries
   connections, so entries whose pods aren't running yet simply sit
   disconnected and receive no players.
3. **Scale out.** When CPU crosses the target, the HPA adds `lavalink-2`,
   `lavalink-3`, … Each pod boots, its DNS name resolves, the bot's waiting node
   entry connects, and `lavalink-client` starts routing **new** player sessions
   to the least-loaded node — load spreads automatically.
4. **Scale in.** When load drops durably (300 s window), the HPA removes the
   highest ordinal first.

This "static endpoints, dynamic backing pods" approach is the pragmatic one. The
fully dynamic alternative — a controller that watches the K8s API and calls
`lavalink-client`'s `nodeManager.createNode()/deleteNode()` as pods come and go —
removes the `maxReplicas`-must-match-`LAVALINK_NODES` coupling but needs extra
bot code, RBAC, and a watch loop. Pre-declaring to a sane ceiling is simpler and
covers real traffic.

## Getting a cluster

You need a real Kubernetes cluster — `kubectl` alone does nothing (the
`dial tcp [::1]:8080 ... refused` error just means no cluster is configured).

- **Windows / macOS (easiest):** you already have Docker Desktop — open
  **Settings → Kubernetes → Enable Kubernetes**, apply, wait for it to go green.
  That gives `kubectl` a working context. Then install metrics-server (the HPA
  needs it; Docker Desktop doesn't ship it):
  ```bash
  kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
  # local clusters use self-signed kubelet certs, so allow insecure TLS:
  kubectl -n kube-system patch deployment metrics-server --type=json \
    -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
  ```
- **Alternative:** `minikube` or `kind` (separate installs — `minikube not
  recognized` just means it isn't installed).

## Deploy

```bash
# 1. Build the bot image. With Docker Desktop's K8s the image is already in the
#    local daemon, so no push/registry needed — just point kustomize at it:
docker build -t elfaria:local .
(cd k8s && kustomize edit set image ghcr.io/pet-al/elfaria=elfaria:local)
# (No kustomize CLI? Edit the `images:` newName/newTag in k8s/kustomization.yaml.)

# 2. Create the Secret (NOT committed):
cp k8s/secrets.example.yaml k8s/secrets.yaml   # then edit in real values
kubectl apply -f k8s/secrets.yaml

# 3. Deploy everything else (the Lavalink config is now a normal manifest, so
#    plain apply -k works — no --load-restrictor flag needed):
kubectl apply -k k8s/

# 4. Register slash commands once (one-off pod):
kubectl -n elfaria run deploy-cmds --rm -it --restart=Never \
  --image=elfaria:local \
  --env="DISCORD_TOKEN=$TOKEN" --env="DISCORD_CLIENT_ID=$CID" \
  -- npm run deploy
```

## Watch it scale

```bash
kubectl -n elfaria get hpa lavalink -w           # REPLICAS column moves with load
kubectl -n elfaria get pods -l app=lavalink      # lavalink-0..N appear/disappear
kubectl -n elfaria logs deploy/elfaria-bot | grep "lavalink node connected"
# → a new "connected" line each time the HPA adds a pod

# Force a scale event for a demo (drive CPU up, or temporarily lower the target):
kubectl -n elfaria patch hpa lavalink --type=merge \
  -p '{"spec":{"metrics":[{"type":"Resource","resource":{"name":"cpu","target":{"type":"Utilization","averageUtilization":5}}}]}}'
```

## Honest caveats

- **Scale-in drops sessions.** Lavalink has no session migration: removing a pod
  kills the players living on it. The HPA's long scale-down window mitigates this,
  but a perfect "drain then terminate" needs a `preStop` hook that waits for the
  node's players to finish — Lavalink doesn't expose that natively. Treat
  scale-in as occasionally interrupting a few streams.
- **CPU is a proxy.** The truer signal is *active players per node*. Expose
  Lavalink's Prometheus metrics, run the Prometheus Adapter, and switch the HPA
  to the `lavalink_playing_players` Pods metric (commented in `lavalink-hpa.yaml`).
- **The bot is one replica.** Running multiple bot pods means splitting Discord
  shards across them (coordinated `SHARD_LIST`/`SHARD_COUNT` per pod, e.g. via a
  StatefulSet ordinal). That's a separate scaling axis from the audio tier and
  isn't needed until ~2,500 guilds.
- **Use managed data services in prod.** The bundled `redis`/`postgres` are fine
  for a demo; for real workloads use managed Redis/Postgres (or operators) for
  backups, HA, and failover.
- **Not applied to a live cluster here.** These manifests are validated for YAML
  and kustomize structure; tune resource requests, storage class, and probes to
  your environment before relying on them.
