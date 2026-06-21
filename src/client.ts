import { Client, Collection, GatewayIntentBits } from 'discord.js';
import type { Command } from './lib/types.js';

/**
 * The gateway client (doc §1).
 *
 * Intents are a least-privilege subscription to gateway events. A music bot
 * needs:
 *   - Guilds          → know about servers/channels/roles.
 *   - GuildVoiceStates → track who is in voice (required to join, and to detect
 *                        an empty channel and auto-leave).
 *
 * We deliberately do NOT request GuildMessages / MessageContent: this bot is
 * slash-command only, so the privileged MessageContent intent is unnecessary.
 */
export class ElfariaClient extends Client {
  /** All loaded slash commands, keyed by command name. */
  public readonly commands = new Collection<string, Command>();

  /** Per-command, per-user cooldown timestamps (doc §8 "your own rate limiting"). */
  public readonly cooldowns = new Collection<string, Collection<string, number>>();

  constructor() {
    super({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    });
  }
}
