import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { LavalinkManager } from 'lavalink-client';
import { config } from './config.js';
import type { Command } from './lib/types.js';

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
    super({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    });

    this.lavalink = new LavalinkManager({
      nodes: [
        {
          id: 'main',
          host: config.lavalink.host,
          port: config.lavalink.port,
          authorization: config.lavalink.password,
          secure: config.lavalink.secure,
          // Lavalink's first boot downloads the YouTube plugin and can take a
          // while; keep retrying so the bot connects once the node is ready.
          retryAmount: 60,
          retryDelay: 5000,
        },
      ],
      // How Lavalink's voice updates get back to Discord: send the op-4 payload
      // out over this guild's shard websocket.
      sendToShard: (guildId, payload) => this.guilds.cache.get(guildId)?.shard?.send(payload),
      autoSkip: true,
      playerOptions: {
        defaultSearchPlatform: config.music.searchPlatform as never,
        // Leave shortly after the queue empties (doc §10).
        onEmptyQueue: { destroyAfterMs: config.music.leaveOnEndMs },
        // Don't try to reconnect a player after a hard disconnect — just clean up.
        onDisconnect: { autoReconnect: false, destroyPlayer: true },
      },
    });
  }
}
