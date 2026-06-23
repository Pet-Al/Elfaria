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

function lavalink(interaction: ChatInputCommandInteraction): LavalinkManager {
  return (interaction.client as ElfariaClient).lavalink;
}

/** The active player for a guild, or undefined if none exists. */
export function getPlayer(interaction: ChatInputCommandInteraction): Player | undefined {
  return lavalink(interaction).getPlayer(interaction.guildId!);
}

/**
 * Get the guild's player, creating + connecting it to the voice channel if
 * needed. Works from any context (slash command, button) — takes the raw pieces
 * rather than an interaction so the now-playing buttons (e.g. Replay) can use it.
 */
export async function ensurePlayer(
  client: ElfariaClient,
  guildId: string,
  voiceChannelId: string,
  textChannelId: string,
): Promise<Player> {
  const manager = client.lavalink;
  let player = manager.getPlayer(guildId);
  if (!player) {
    const settings = await getGuildSettings(guildId);
    player = manager.createPlayer({
      guildId,
      voiceChannelId,
      textChannelId,
      selfDeaf: true,
      volume: settings.defaultVolume,
    });
  }
  if (!player.connected) await player.connect();
  return player;
}

/** Convenience wrapper over ensurePlayer for slash commands. */
export async function getOrCreatePlayer(
  interaction: ChatInputCommandInteraction,
  voiceChannelId: string,
): Promise<Player> {
  return ensurePlayer(
    interaction.client as ElfariaClient,
    interaction.guildId!,
    voiceChannelId,
    interaction.channelId,
  );
}

/** The requester object we store on tracks for "requested by" display. */
export function requesterOf(user: User): { id: string; username: string } {
  return { id: user.id, username: user.username };
}

/**
 * Destroy (and disconnect) a player that has nothing to play — i.e. a request
 * that connected to voice but resolved no tracks (a broken link, an unsupported
 * playlist). Without this the bot would sit idle in the channel forever, since
 * the leave-on-end timer only starts after something has actually played.
 */
export async function leaveIfIdle(player: Player): Promise<void> {
  if (!player.playing && !player.paused && !player.queue.current && player.queue.tracks.length === 0) {
    await player.destroy('nothing to play').catch(() => undefined);
  }
}

/** Format a millisecond duration as h:mm:ss or m:ss. Zero/unknown → "0:00". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
