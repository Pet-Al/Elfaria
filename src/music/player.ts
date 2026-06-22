import { EventEmitter } from 'node:events';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  EmbedBuilder,
} from 'discord.js';
import type { Track } from 'lavalink-client';
import type { ElfariaClient } from '../client.js';
import { logger } from '../lib/logger.js';
import { formatDuration } from './QueueManager.js';

/**
 * Lavalink wiring (doc §3 Option B).
 *
 * Three responsibilities:
 *   1. Forward Discord's raw voice packets to Lavalink so it can open the voice
 *      UDP connection (this is the bridge that makes offloaded audio work).
 *   2. Log node lifecycle (connect / error / disconnect) — our observability
 *      into the audio service (doc §10).
 *   3. Announce track starts and surface track errors in the bound text channel.
 */

function nowPlayingEmbed(track: Track): EmbedBuilder {
  const requester = track.requester as { username?: string } | undefined;
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('▶️ Now playing')
    .setDescription(`**[${track.info.title}](${track.info.uri})**`)
    .addFields(
      { name: 'Author', value: track.info.author || 'Unknown', inline: true },
      {
        name: 'Duration',
        value: track.info.isStream ? 'live' : formatDuration(track.info.duration),
        inline: true,
      },
    )
    .setThumbnail(track.info.artworkUrl)
    .setFooter({ text: requester?.username ? `Requested by ${requester.username}` : 'Elfaria' });
}

/** The now-playing control panel. Buttons are handled in events/buttons.ts. */
function controlRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('np:playpause').setEmoji('⏯️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('np:skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('np:stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('np:shuffle').setEmoji('🔀').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('np:queue').setEmoji('📜').setStyle(ButtonStyle.Secondary),
  );
}

async function send(client: Client, channelId: string | null, payload: object): Promise<void> {
  if (!channelId) return;
  const channel = client.channels.cache.get(channelId);
  if (channel?.isSendable()) {
    await channel.send(payload).catch((err) => logger.warn({ err }, 'failed to send message'));
  }
}

export function registerLavalinkEvents(client: ElfariaClient): void {
  // 1. Bridge: every gateway voice packet must reach Lavalink. discord.js emits
  // "raw" for every payload but doesn't type it, so we go through EventEmitter.
  (client as unknown as EventEmitter).on('raw', (packet: unknown) => {
    void client.lavalink.sendRawData(packet as never);
  });

  // 2. Node lifecycle.
  client.lavalink.nodeManager
    .on('connect', (node) => logger.info({ node: node.id }, 'lavalink node connected'))
    .on('disconnect', (node, reason) =>
      logger.warn({ node: node.id, reason }, 'lavalink node disconnected'),
    )
    .on('error', (node, error) =>
      logger.error({ node: node.id, err: error }, 'lavalink node error'),
    )
    .on('reconnecting', (node) => logger.info({ node: node.id }, 'lavalink node reconnecting'));

  // 3. Playback lifecycle.
  client.lavalink
    .on('trackStart', (player, track) => {
      logger.info({ guildId: player.guildId, track: track?.info.title }, 'playback started');
      if (track) {
        void send(client, player.textChannelId, {
          embeds: [nowPlayingEmbed(track)],
          components: [controlRow()],
        });
      }
    })
    .on('queueEnd', (player) => {
      logger.info({ guildId: player.guildId }, 'queue ended');
      void send(client, player.textChannelId, {
        content: '✅ Queue finished. Leaving soon if nothing else is added.',
      });
    })
    .on('trackError', (player, track, payload) => {
      logger.error(
        { guildId: player.guildId, track: track?.info?.title, exception: payload.exception },
        'track error',
      );
      void send(client, player.textChannelId, {
        content: `⚠️ Error playing **${track?.info?.title ?? 'a track'}**, skipping.`,
      });
    })
    .on('playerDisconnect', (player) => {
      logger.info({ guildId: player.guildId }, 'player disconnected from voice');
    });
}
