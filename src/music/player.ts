import { EventEmitter } from 'node:events';
import { type Client, type Message, MessageFlags } from 'discord.js';
import type { Player, Track } from 'lavalink-client';
import type { ElfariaClient } from '../client.js';
import { recordPlay } from '../db/history.js';
import { getAccentColor } from '../lib/artwork.js';
import { logger } from '../lib/logger.js';
import { type CardOptions, nowPlayingCard, replayRow } from './nowPlayingCard.js';

/**
 * Lavalink wiring (doc §3 Option B).
 *
 * Responsibilities:
 *   1. Forward Discord's raw voice packets to Lavalink so it can open the voice
 *      UDP connection (this is the bridge that makes offloaded audio work).
 *   2. Log node lifecycle (connect / error / disconnect) — observability.
 *   3. Announce track starts (a Components V2 card with controls, an
 *      artwork-tinted accent, and a live-updating progress bar), record play
 *      history, and surface track errors in the bound text channel.
 */

/** How often the now-playing progress bar is refreshed. */
const PROGRESS_UPDATE_MS = 15_000;

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

/** The card options that describe the current player state (queue, volume, loop). */
function panelOptions(player: Player, positionMs?: number): CardOptions {
  return {
    positionMs,
    withVolumeSelect: true,
    volume: player.volume,
    repeatMode: player.repeatMode,
    upNext: player.queue.tracks.slice(0, 3).map((t) => t.info?.title ?? 'Unknown'),
    queueLength: player.queue.tracks.length,
  };
}

/**
 * Re-render the live panel with the current player state (progress bar ticking,
 * loop/volume indicators). Exported so the loop button can refresh immediately.
 */
export async function refreshPanel(player: Player): Promise<void> {
  const message = player.get<Message | undefined>('npMessage');
  const track = player.get<Track | undefined>('npTrack');
  if (!message || !track) return;
  const accentColor = await getAccentColor(track.info.artworkUrl);
  await message
    .edit({
      flags: MessageFlags.IsComponentsV2,
      components: [nowPlayingCard(track, { ...panelOptions(player, player.position), accentColor })],
    })
    .catch(() => undefined);
}

function startProgressUpdates(player: Player): void {
  const handle = setInterval(() => {
    if (player.playing) void refreshPanel(player);
  }, PROGRESS_UPDATE_MS);
  player.set('npInterval', handle);
}

/**
 * Retire a guild's previous now-playing panel: stop its progress timer and grey
 * out its controls. We keep only the current song's panel live, so stale
 * messages — even from days ago — stop responding (Discord components never
 * expire on their own). Because the card is Components V2 we rebuild the whole
 * container (from the stored track) with everything disabled.
 */
async function disablePanel(player: Player): Promise<void> {
  const handle = player.get<NodeJS.Timeout | undefined>('npInterval');
  if (handle) {
    clearInterval(handle);
    player.set('npInterval', undefined);
  }

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

      // Log it to play history (fire-and-forget) for /history and /replay.
      if (track.info.uri) {
        const requester = track.requester as { id?: string } | undefined;
        void recordPlay(
          player.guildId,
          { title: track.info.title, uri: track.info.uri, author: track.info.author },
          requester?.id,
        ).catch((err) => logger.warn({ err }, 'failed to record play history'));
      }

      const accentColor = await getAccentColor(track.info.artworkUrl);
      const message = await send(client, player.textChannelId, {
        flags: MessageFlags.IsComponentsV2,
        components: [
          nowPlayingCard(track, { ...panelOptions(player, player.position), accentColor }),
        ],
      });
      if (message) {
        player.set('npMessage', message);
        player.set('npTrack', track);
        startProgressUpdates(player);
      }
    })
    .on('queueEnd', (player) => {
      logger.info({ guildId: player.guildId }, 'queue ended');
      void disablePanel(player);
      // Offer a one-click Replay of the last track (handled in events/buttons.ts).
      void send(client, player.textChannelId, {
        content: '✅ Queue finished. Leaving soon if nothing else is added.',
        components: [replayRow()],
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
