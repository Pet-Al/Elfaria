import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { LavalinkManager } from 'lavalink-client';
import { config } from './config.js';
import type { Command } from './lib/types.js';
import { autoPlayFunction } from './music/autoplay.js';

/**
 * The gateway client (doc §1) plus the Lavalink manager (doc §3 Option B).
 *
 * Intents are a least-privilege subscription to gateway events. A music bot
 * needs:
 *   - Guilds          → know about servers/channels/roles.
 *   - GuildVoiceStates → track who is in voice (required to join, and to detect
 *                        an empty channel and auto-leave).
 *
 * We deliberately do NOT request GuildMessages / MessageContent: this bot is
 * slash-command only.
 *
 * The LavalinkManager is constructed here and lives on the client so every
 * command can reach it via `interaction.client.lavalink`. It does no audio work
 * itself — it forwards Discord voice updates to the Lavalink node (via
 * `sendToShard`) and sends play/queue commands over a small WebSocket/REST link.
 */
export class ElfariaClient extends Client {
  /** All loaded slash commands, keyed by command name. */
  public readonly commands = new Collection<string, Command>();

  /** Per-command, per-user cooldown timestamps (doc §8 "your own rate limiting"). */
  public readonly cooldowns = new Collection<string, Collection<string, number>>();

  /** The Lavalink audio manager (doc §3). */
  public readonly lavalink: LavalinkManager;

  constructor() {
    // Multi-pod sharding: when this pod has a coordinated shard assignment, tell
    // discord.js exactly which shard ids to open and the global shardCount, so
    // pods own disjoint ranges of the same logical bot (doc roadmap). Absent →
    // a single process (or the ShardingManager path, which injects via env).
    const assignment = config.sharding.multiPod;
    super({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
      ...(assignment
        ? { shards: assignment.shardIds, shardCount: assignment.totalShards }
        : {}),
    });

    this.lavalink = new LavalinkManager({
      // One or more nodes (doc §9). lavalink-client balances sessions across
      // them; configure extra nodes via LAVALINK_NODES (see config.ts).
      nodes: config.lavalink.nodes.map((node) => ({
        ...node,
        // Lavalink's first boot downloads plugins and can take a while; keep
        // retrying so the bot connects once each node is ready.
        retryAmount: 60,
        retryDelay: 5000,
      })),
      // How Lavalink's voice updates get back to Discord: send the op-4 payload
      // out over this guild's shard websocket.
      sendToShard: (guildId, payload) => this.guilds.cache.get(guildId)?.shard?.send(payload),
      autoSkip: true,
      playerOptions: {
        defaultSearchPlatform: config.music.searchPlatform as never,
        // When the queue empties: optionally autoplay a related track (per-guild
        // toggle via /autoplay); otherwise leave shortly after (doc §10).
        onEmptyQueue: { destroyAfterMs: config.music.leaveOnEndMs, autoPlayFunction },
        // Don't try to reconnect a player after a hard disconnect — just clean up.
        onDisconnect: { autoReconnect: false, destroyPlayer: true },
      },
    });
  }
}
