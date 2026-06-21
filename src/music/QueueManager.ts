import { type GuildQueue, useQueue } from 'discord-player';
import { config } from '../config.js';
import { getGuildSettings } from '../db/guilds.js';
import type { QueueMetadata } from '../lib/types.js';

/**
 * Queue helpers (doc §5).
 *
 * discord-player keeps the authoritative per-guild queue in memory; we don't
 * reinvent it. This module is just the thin, typed bridge the command layer
 * uses: a typed accessor for the active queue and a single place that builds
 * the queue's options (volume from persisted guild settings, auto-leave
 * timeouts from config). Keeping these in one spot means every command creates
 * queues that behave identically.
 */

export type ElfariaQueue = GuildQueue<QueueMetadata>;

/** Get the active queue for a guild, or null if nothing is playing there. */
export function getQueue(guildId: string): ElfariaQueue | null {
  return useQueue(guildId) as ElfariaQueue | null;
}

/**
 * Build the node options for player.play(). Volume is sourced from the guild's
 * persisted default (doc §6); auto-leave behaviour from config (doc §10).
 */
export function buildNodeOptions(guildId: string, metadata: QueueMetadata) {
  const settings = getGuildSettings(guildId);
  return {
    metadata,
    volume: settings.defaultVolume,
    selfDeaf: true,
    leaveOnEmpty: true,
    leaveOnEmptyCooldown: config.music.leaveOnEmptyCooldownMs,
    leaveOnEnd: true,
    leaveOnEndCooldown: config.music.leaveOnEndCooldownMs,
  };
}
