import { DefaultExtractors } from '@discord-player/extractor';
import { Player, type GuildQueue, type Track } from 'discord-player';
import { EmbedBuilder } from 'discord.js';
import type { ElfariaClient } from '../client.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import type { QueueMetadata } from '../lib/types.js';

/**
 * Voice subsystem wiring (doc §3 + §4, "Option A — in-process").
 *
 * discord-player owns the heavy lifting: it joins voice over a separate
 * encrypted UDP path, runs FFmpeg to transcode the source to Opus, and manages
 * the per-guild queue. We:
 *   1. create the Player singleton (retrievable anywhere via useMainPlayer()),
 *   2. register source extractors (the fragile layer — kept isolated here),
 *   3. wire queue lifecycle events to announcements + structured logging.
 */

function metaOf(queue: GuildQueue): QueueMetadata | null {
  return (queue.metadata as QueueMetadata | null) ?? null;
}

function nowPlayingEmbed(track: Track): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('▶️ Now playing')
    .setDescription(`**[${track.title}](${track.url})**`)
    .addFields(
      { name: 'Author', value: track.author || 'Unknown', inline: true },
      { name: 'Duration', value: track.duration || 'Unknown', inline: true },
    )
    .setThumbnail(track.thumbnail || null)
    .setFooter({
      text: track.requestedBy ? `Requested by ${track.requestedBy.username}` : 'Elfaria',
    });
}

export async function initPlayer(client: ElfariaClient): Promise<Player> {
  const player = new Player(client);

  // Default extractors: SoundCloud, Vimeo, attachments, plus Spotify/Apple
  // *bridging* (their links resolve metadata then stream from another source).
  await player.extractors.loadMulti(DefaultExtractors);

  // YouTube extraction is the fragile part (doc §4). Load it dynamically and
  // tolerate failure: if it breaks, the rest of the bot still works and we just
  // log a warning rather than crashing on boot.
  //
  // The streaming client and optional cookie are configurable (see config) so
  // that, when YouTube changes and the default client stops streaming, you can
  // switch clients or add an account cookie via .env without touching code.
  try {
    const { YoutubeiExtractor } = await import('discord-player-youtubei');
    const { streamClient, cookie } = config.music.youtube;
    await player.extractors.register(YoutubeiExtractor, {
      streamOptions: { useClient: streamClient as never },
      ...(cookie ? { cookie } : {}),
    });
    logger.info({ streamClient, authenticated: Boolean(cookie) }, 'youtube extractor registered');
  } catch (err) {
    logger.warn({ err }, 'failed to register YouTube extractor — YouTube sourcing disabled');
  }

  registerPlayerEvents(player);

  logger.info({ extractors: player.extractors.store.size }, 'discord-player initialised');
  return player;
}

function registerPlayerEvents(player: Player): void {
  player.events.on('playerStart', (queue, track) => {
    const meta = metaOf(queue);
    logger.info({ guildId: queue.guild.id, track: track.title }, 'playback started');
    meta?.channel.send({ embeds: [nowPlayingEmbed(track)] }).catch((err) => {
      logger.warn({ err, guildId: queue.guild.id }, 'failed to send now-playing message');
    });
  });

  player.events.on('emptyQueue', (queue) => {
    const meta = metaOf(queue);
    logger.info({ guildId: queue.guild.id }, 'queue ended');
    meta?.channel
      .send('✅ Queue finished. Leaving soon if nothing else is added.')
      .catch(() => undefined);
  });

  player.events.on('emptyChannel', (queue) => {
    logger.info({ guildId: queue.guild.id }, 'voice channel empty — will auto-leave');
  });

  player.events.on('disconnect', (queue) => {
    logger.info({ guildId: queue.guild.id }, 'disconnected from voice');
  });

  // A track failed to stream. Don't crash — log and tell the channel.
  player.events.on('playerError', (queue, error, track) => {
    logger.error(
      { err: error, guildId: queue.guild.id, track: track?.title },
      'player error while streaming track',
    );
    metaOf(queue)
      ?.channel.send(`⚠️ Error playing **${track?.title ?? 'a track'}**, skipping.`)
      .catch(() => undefined);
  });

  // Generic queue error (e.g. failed to connect/transcode).
  player.events.on('error', (queue, error) => {
    logger.error({ err: error, guildId: queue.guild.id }, 'queue error');
  });
}
