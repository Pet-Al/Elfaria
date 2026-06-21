import type { ChatInputCommandInteraction, User } from 'discord.js';
import type { LavalinkManager, Player } from 'lavalink-client';
import type { ElfariaClient } from '../client.js';
import { getGuildSettings } from '../db/guilds.js';

/**
 * Queue/player helpers (doc §5).
 *
 * Lavalink owns the authoritative per-guild player and queue in memory; we don't
 * reinvent them. This module is the thin, typed bridge the command layer uses:
 * reach the manager, get/create the guild's player, and a couple of formatting
 * helpers. Keeping player creation in one place means every command creates
 * players that behave identically (volume from settings, self-deafened).
 */

export function lavalink(interaction: ChatInputCommandInteraction): LavalinkManager {
  return (interaction.client as ElfariaClient).lavalink;
}

/** The active player for a guild, or undefined if none exists. */
export function getPlayer(interaction: ChatInputCommandInteraction): Player | undefined {
  return lavalink(interaction).getPlayer(interaction.guildId!);
}

/** Get the guild's player, creating + connecting it to the voice channel if needed. */
export async function getOrCreatePlayer(
  interaction: ChatInputCommandInteraction,
  voiceChannelId: string,
): Promise<Player> {
  const manager = lavalink(interaction);
  const guildId = interaction.guildId!;

  let player = manager.getPlayer(guildId);
  if (!player) {
    const settings = getGuildSettings(guildId);
    player = manager.createPlayer({
      guildId,
      voiceChannelId,
      textChannelId: interaction.channelId,
      selfDeaf: true,
      volume: settings.defaultVolume,
    });
  }
  if (!player.connected) await player.connect();
  return player;
}

/** The requester object we store on tracks for "requested by" display. */
export function requesterOf(user: User): { id: string; username: string } {
  return { id: user.id, username: user.username };
}

/** Format a millisecond duration as h:mm:ss or m:ss. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'live';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
