import { EventEmitter } from 'node:events';
import { type Client, type ContainerBuilder, type Message, MessageFlags } from 'discord.js';
import type { Player, Track } from 'lavalink-client';
import type { ElfariaClient } from '../client.js';
import { config } from '../config.js';
import { recordEvent } from '../analytics/events.js';
import { recordPlay } from '../db/history.js';
import { cachedAccentColor, getAccentColor } from '../lib/artwork.js';
import { logger } from '../lib/logger.js';
import { fillAutoplayBuffer } from './autoplay.js';
import { loopStateOf, settleLoopOnce } from './loop.js';
import { type CardOptions, nowPlayingCard } from './nowPlayingCard.js';
import { forgetPanel, rememberPanel } from './panelStore.js';

/**
 * Lavalink wiring (doc §3 Option B).
 *
 * Responsibilities:
 *   1. Forward Discord's raw voice packets to Lavalink (the voice bridge).
 *   2. Log node lifecycle — observability.
 *   3. Drive the now-playing card: ONE panel per guild that updates in place for
 *      each track when nothing else has been posted since (so the channel isn't
 *      spammed); when the channel has moved on, the old panel is greyed and a
 *      fresh one is posted. The progress bar ticks on a configurable interval.
 *      When the queue finishes, the panel becomes the final card with a Replay
 *      button. Track starts are also written to play history.
 */

/** Live-progress refresh interval (0 disables live updates — see config). */
const REFRESH_MS = config.music.nowPlayingRefreshMs;
/** Minimum spacing between panel edits, so bursts can't flood a channel. */
const MIN_EDIT_INTERVAL_MS = 3_000;

const V2 = { flags: MessageFlags.IsComponentsV2 } as const;

/** Card options describing the current player state (queue, volume, loop). */
function panelOptions(player: Player, positionMs?: number): CardOptions {
  return {
    positionMs,
    volume: player.volume,
    loopState: loopStateOf(player),
    upNext: player.queue.tracks.slice(0, 3).map((t) => t.info?.title ?? 'Unknown'),
    queueLength: player.queue.tracks.length,
  };
}

function clearTimer(player: Player): void {
  const handle = player.get<NodeJS.Timeout | undefined>('npInterval');
  if (handle) clearInterval(handle);
  player.set('npInterval', undefined);
}

/**
 * Grey out a panel. `withReplay` adds the active Replay button — used for the
 * FINAL panel (queue finished, or the bot leaving on idle/pause), so the card is
 * greyed but the track can still be brought back. A buried mid-playback panel
 * uses withReplay=false (no live control). Keeps the artwork accent either way.
 */
async function greyPanel(message: Message, track: Track, withReplay = false): Promise<void> {
  await message
    .edit({
      ...V2,
      components: [
        nowPlayingCard(track, {
          disabled: true,
          withReplay,
          accentColor: cachedAccentColor(track.info.artworkUrl),
        }),
      ],
    })
    .catch(() => undefined);
}

/**
 * Show `components` as the guild's now-playing panel. Edits the existing panel
 * IN PLACE when it's still the latest message in the channel (no one has posted
 * since); otherwise greys the buried panel and posts a fresh one. Returns the
 * message now serving as the panel.
 */
async function placePanel(
  client: Client,
  player: Player,
  components: ContainerBuilder[],
): Promise<Message | undefined> {
  const channelId = player.textChannelId;
  if (!channelId) return undefined;
  const channel = client.channels.cache.get(channelId);
  if (!channel?.isSendable()) return undefined;

  const existing = player.get<Message | undefined>('npMessage');
  const payload = { ...V2, components };

  if (existing && channel.lastMessageId === existing.id) {
    const edited = await existing.edit(payload).catch(() => undefined);
    if (edited) return edited;
  }
  if (existing) {
    const oldTrack = player.get<Track | undefined>('npTrack');
    if (oldTrack) await greyPanel(existing, oldTrack);
  }
  return channel.send(payload).catch((err) => {
    logger.warn({ err }, 'failed to send now-playing panel');
    return undefined;
  });
}

/**
 * Re-render the live panel (progress bar ticking, loop/volume state). Exported so
 * the loop/volume controls can refresh immediately. Throttled to one edit per
 * MIN_EDIT_INTERVAL_MS per player — on top of discord.js's own rate-limit queue.
 */
export async function refreshPanel(player: Player, force = false): Promise<void> {
  const message = player.get<Message | undefined>('npMessage');
  const track = player.get<Track | undefined>('npTrack');
  if (!message || !track) return;

  const last = player.get<number | undefined>('npLastEdit') ?? 0;
  if (!force && Date.now() - last < MIN_EDIT_INTERVAL_MS) return;
  player.set('npLastEdit', Date.now());

  const accentColor = await getAccentColor(track.info.artworkUrl);
  await message
    .edit({ ...V2, components: [nowPlayingCard(track, { ...panelOptions(player, player.position), accentColor })] })
    .catch(() => undefined);
}

function startProgressUpdates(player: Player): void {
  if (REFRESH_MS <= 0) return; // live updates disabled (e.g. at very large scale)
  const handle = setInterval(() => {
    if (player.playing) void refreshPanel(player);
  }, REFRESH_MS);
  player.set('npInterval', handle);
}

/**
 * Don't sit paused in a voice channel forever. When a player is paused we arm a
 * timer; if it's still paused after leaveOnEndMs we leave. Resuming, a new track,
 * or destruction clears it. (An *empty* channel is handled separately by
 * events/voiceStateUpdate.ts.)
 */
function clearPauseTimer(player: Player): void {
  const handle = player.get<NodeJS.Timeout | undefined>('pauseTimer');
  if (handle) clearTimeout(handle);
  player.set('pauseTimer', undefined);
}

function armPauseTimer(player: Player): void {
  clearPauseTimer(player);
  const handle = setTimeout(() => {
    if (player.paused) {
      logger.info({ guildId: player.guildId }, 'paused too long — leaving');
      void player.destroy('Paused inactivity').catch(() => undefined);
    }
  }, config.music.leaveOnEndMs);
  player.set('pauseTimer', handle);
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

      await settleLoopOnce(player, track.info.identifier); // disarm one-shot loops
      clearTimer(player);
      clearPauseTimer(player);
      player.set('npFinished', false);

      if (track.info.uri) {
        const requester = track.requester as { id?: string } | undefined;
        void recordPlay(
          player.guildId,
          { title: track.info.title, uri: track.info.uri, author: track.info.author },
          requester?.id,
        ).catch((err) => logger.warn({ err }, 'failed to record play history'));
        recordEvent({
          type: 'play',
          guildId: player.guildId,
          userId: requester?.id,
          title: track.info.title,
          uri: track.info.uri,
          author: track.info.author,
        });
      }

      const accentColor = await getAccentColor(track.info.artworkUrl);
      const message = await placePanel(client, player, [
        nowPlayingCard(track, { ...panelOptions(player, player.position), accentColor }),
      ]);
      if (message) {
        player.set('npMessage', message);
        player.set('npTrack', track);
        startProgressUpdates(player);
        // Persist the live panel so it can be retired if this process dies before
        // the panel is cleanly greyed (crash/OOM/kill) — see panelStore.ts.
        void rememberPanel(player.guildId, message.channelId, message.id);
      }

      // Proactively top up the autoplay buffer so the picks appear in "up next"
      // WHILE the current track plays — not only once the queue swaps to them.
      if (player.get<boolean>('autoplay')) {
        void fillAutoplayBuffer(player, track).then((added) => {
          if (added > 0) void refreshPanel(player, true);
        });
      }
    })
    .on('queueEnd', async (player) => {
      logger.info({ guildId: player.guildId }, 'queue ended');
      clearTimer(player);

      // 24/7 mode: cancel lavalink-client's queue-empty disconnect so the bot
      // stays connected (the empty-channel rule in voiceStateUpdate still applies).
      if (player.get<boolean>('247')) {
        const pending = player.get<NodeJS.Timeout | undefined>('internal_queueempty');
        if (pending) clearTimeout(pending);
        player.set('internal_queueempty', undefined);
      }

      player.set('npFinished', true);

      const track = player.get<Track | undefined>('npTrack');
      if (!track) {
        void send(client, player.textChannelId, { content: '✅ Queue finished.' });
        return;
      }
      // Transform the panel into the FINAL card — greyed controls + a Replay button.
      const message = await placePanel(client, player, [
        nowPlayingCard(track, {
          disabled: true,
          withReplay: true,
          accentColor: cachedAccentColor(track.info.artworkUrl),
        }),
      ]);
      if (message) player.set('npMessage', message);
      // The final card's Replay/Favorite work standalone — no need to retire it.
      void forgetPanel(player.guildId);
    })
    .on('trackError', (player, track, payload) => {
      logger.error(
        { guildId: player.guildId, track: track?.info?.title, exception: payload.exception },
        'track error',
      );
      void send(client, player.textChannelId, {
        content: `⚠️ Error playing **${track?.info?.title ?? 'a track'}**, skipping to the next.`,
      });
    })
    .on('trackStuck', (player, track) => {
      // The track stalled (no audio frames). lavalink-client auto-advances; we
      // surface it so a "the song just died" moment is visible, not silent.
      logger.warn(
        { guildId: player.guildId, track: track?.info?.title },
        'track stuck — skipping to the next',
      );
      void send(client, player.textChannelId, {
        content: `⚠️ **${track?.info?.title ?? 'A track'}** stalled and was skipped.`,
      });
    })
    .on('playerPaused', (player) => {
      // Don't linger paused in voice forever — arm the inactivity leave. In 24/7
      // mode we skip it (the empty-channel rule still covers "nobody's here").
      if (!player.get<boolean>('247')) armPauseTimer(player);
      void refreshPanel(player, true);
    })
    .on('playerResumed', (player) => {
      clearPauseTimer(player);
      void refreshPanel(player, true);
    })
    .on('playerDisconnect', (player) => {
      logger.info({ guildId: player.guildId }, 'player disconnected from voice');
    })
    .on('playerDestroy', (player) => {
      clearTimer(player);
      clearPauseTimer(player);
      // However the player goes away, the greyed card below is standalone-
      // functional, so the saved ref is no longer needed.
      void forgetPanel(player.guildId);
      // queueEnd already rendered the final card (grey + Replay). For every other
      // way the player goes away — stop, pause-timeout, empty channel, idle leave —
      // grey the live panel AND keep a Replay button, so the card always greys out
      // and the last track can be brought back.
      if (player.get('npFinished')) return;
      const message = player.get<Message | undefined>('npMessage');
      const track = player.get<Track | undefined>('npTrack');
      player.set('npMessage', undefined);
      player.set('npTrack', undefined);
      if (message && track) void greyPanel(message, track, true);
    });
}

/** Send a plain message to a channel (used for transient notices). */
async function send(client: Client, channelId: string | null, payload: object): Promise<void> {
  if (!channelId) return;
  const channel = client.channels.cache.get(channelId);
  if (channel?.isSendable()) {
    await channel.send(payload).catch((err) => logger.warn({ err }, 'failed to send message'));
  }
}
