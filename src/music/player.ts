import { EventEmitter } from 'node:events';
import { type Client, type Message, MessageFlags } from 'discord.js';
import type { Player, Track } from 'lavalink-client';
import type { ElfariaClient } from '../client.js';
import { logger } from '../lib/logger.js';
import { nowPlayingCard } from './nowPlayingCard.js';

/**
 * Lavalink wiring (doc §3 Option B).
 *
 * Three responsibilities:
 *   1. Forward Discord's raw voice packets to Lavalink so it can open the voice
 *      UDP connection (this is the bridge that makes offloaded audio work).
 *   2. Log node lifecycle (connect / error / disconnect) — our observability
 *      into the audio service (doc §10).
 *   3. Announce track starts (a Components V2 card with controls) and surface
 *      track errors in the bound text channel.
 */

async function send(
  client: Client,
  channelId: string | null,
  payload: object,
): Promise<Message | undefined> {
  if (!channelId) return undefined;
  const channel = client.channels.cache.get(channelId);
  if (!channel?.isSendable()) return undefined;
  return channel.send(payload).catch((err) => {
    logger.warn({ err }, 'failed to send message');
    return undefined;
  });
}

/**
 * Grey out the buttons on a guild's previous now-playing panel, if one is
 * tracked. We keep only the current song's controls live: when a new track
 * starts (or the queue ends / player is destroyed) the old panel is disabled
 * so stale messages — even from days ago — stop responding. Because the card is
 * Components V2 we rebuild the whole container (from the stored track) with the
 * buttons disabled rather than editing the buttons in isolation.
 */
async function disablePanel(player: Player): Promise<void> {
  const previous = player.get<Message | undefined>('npMessage');
  const track = player.get<Track | undefined>('npTrack');
  player.set('npMessage', undefined);
  player.set('npTrack', undefined);
  if (!previous || !track) return;
  await previous
    .edit({
      flags: MessageFlags.IsComponentsV2,
      components: [nowPlayingCard(track, { disabled: true, withVolumeSelect: true })],
    })
    .catch(() => undefined);
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
    .on('trackStart', async (player, track) => {
      logger.info(
        { guildId: player.guildId, node: player.node?.id, track: track?.info.title },
        'playback started',
      );
      if (!track) return;
      // Retire the previous song's panel so only the current controls are live.
      await disablePanel(player);
      const upNext = player.queue.tracks.slice(0, 3).map((t) => t.info?.title ?? 'Unknown');
      const message = await send(client, player.textChannelId, {
        flags: MessageFlags.IsComponentsV2,
        components: [
          nowPlayingCard(track, {
            withVolumeSelect: true,
            volume: player.volume,
            repeatMode: player.repeatMode,
            upNext,
            queueLength: player.queue.tracks.length,
          }),
        ],
      });
      if (message) {
        player.set('npMessage', message);
        player.set('npTrack', track);
      }
    })
    .on('queueEnd', (player) => {
      logger.info({ guildId: player.guildId }, 'queue ended');
      void disablePanel(player);
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
    })
    .on('playerDestroy', (player) => {
      // Stop button / inactivity leave: disable whatever panel is still showing.
      void disablePanel(player);
    });
}
