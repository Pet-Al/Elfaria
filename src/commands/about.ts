import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../lib/types.js';

/**
 * /about — the full Elfaria tech stack, architecture, and backend, for the
 * curious (and the buzzword-inclined). Curated so it reads like a one-screen
 * architecture brief rather than a config dump.
 */
const FIELDS: { name: string; value: string }[] = [
  {
    name: '🤖 Gateway & runtime',
    value:
      'TypeScript (strict, ESM) on Node 22 via **tsx**. **discord.js v14** — slash-commands only, ' +
      'least-privilege intents, **Components V2** UI, DAVE E2E voice encryption. Multi-pod ' +
      '**gateway sharding** with coordinated shard ranges.',
  },
  {
    name: '🎧 Audio',
    value:
      'Offloaded to **Lavalink v4** (youtube-source + LavaSrc) over a thin client — sourcing, ' +
      'Opus transcoding, and UDP streaming happen there, not in the latency-sensitive bot. ' +
      'Multi-node, session-balanced, DB-persisted queues.',
  },
  {
    name: '🗄️ Data tier',
    value:
      'Dialect-agnostic driver: **SQLite** (dev) → **Postgres** (prod, HA via CloudNativePG) with ' +
      'a **read replica** split. **Redis** for the shared search cache + cross-pod presence. ' +
      'An event pipeline streams to the DB and optionally **Kafka**.',
  },
  {
    name: '🧠 ML & data science',
    value:
      'A **Spotify-style multi-model recommender**: collaborative filtering ' +
      '(**item2vec** + co-play), a **session** model, **NLP/semantic** and **audio-analysis** ' +
      'pillars, fused by a **BaRT-style** blender with an exploration arm — plus per-user ' +
      'taste profiles and an **A/B framework**. Trained offline, hot-reloaded nightly.',
  },
  {
    name: '📈 Observability & SRE',
    value:
      '**Prometheus** RED metrics + **Grafana**, **OpenTelemetry** tracing, **SLOs** with ' +
      'multi-window **error-budget burn-rate** alerts, a black-box **play canary**, predictive ' +
      'autoscaling (**KEDA** + `predict_linear`) and anomaly detection. Chaos-tested.',
  },
  {
    name: '🚢 Platform & security',
    value:
      '**Docker** + **Kubernetes** (HPA, StatefulSets, NetworkPolicy, non-root/seccomp), ' +
      'canary rollouts, **External Secrets** rotation, CI (lint/typecheck/test + **Trivy** scan), ' +
      'CD to GHCR. GDPR: `/forget-me`, retention, PII-free public API + dashboard.',
  },
];

export const about: Command = {
  data: new SlashCommandBuilder()
    .setName('about')
    .setDescription('Elfaria’s tech stack, architecture & backend.'),
  cooldownMs: 0,
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎶 Elfaria — under the hood')
      .setDescription(
        'A flagship, production-grade Discord music bot: cloud-native, observable, ' +
          'self-healing, and data-driven. The short version of the stack:',
      )
      .addFields(FIELDS)
      .setFooter({ text: 'Full reference: docs/REFERENCE.md · architecture: docs/ARCHITECTURE_COMPARISON.md' });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
