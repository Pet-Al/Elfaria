import { EventEmitter } from 'node:events';
import { type Client, type ContainerBuilder, type Message, MessageFlags } from 'discord.js';
import type { Player, Track } from 'lavalink-client';
import type { ElfariaClient } from '../client.js';
import { config } from '../config.js';
import { recordEvent } from '../analytics/events.js';
import { setAppSetting } from '../db/appSettings.js';
import { recordPlay } from '../db/history.js';
import { autoplayKey } from './QueueManager.js';
import { cachedAccentColor, getAccentColor } from '../lib/artwork.js';
import { type SyncedLine, currentLine, fetchSyncedLyrics } from '../lib/lyrics.js';
import { logger } from '../lib/logger.js';
import { fillAutoplayBuffer } from './autoplay.js';
import { loopStateOf, settleLoopOnce } from './loop.js';
import { type CardOptions, nowPlayingCard } from './nowPlayingCard.js';
import { clearPanelDirty, markPanelDirty, startPanelScheduler } from './panelScheduler.js';
import {
  armPanelExpiry,
  clearPanelExpiry,
  forgetPanel,
  rememberCardTrack,
  rememberPanel,
} from './panelStore.js';
import { dbQueueStore } from './queueStore.js';

/** Request a now-playing card refresh. Routes through the single update pipeline
 * (panelScheduler) — callers never edit Discord directly, so command bursts
 * can't stall or spam the live timer/lyrics. Re-exported for the command layer. */
export { markPanelDirty as refreshPanel } from './panelScheduler.js';

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

const V2 = { flags: MessageFlags.IsComponentsV2 } as const;

/** Card options describing the current player state (queue, volume, loop, lyric
 * line, and the active-modifier badges shown in the tags area). */
function panelOptions(player: Player, positionMs?: number): CardOptions {
  const synced = player.get<SyncedLine[]>('syncedLyrics');
  return {
    positionMs,
    volume: player.volume,
    loopState: loopStateOf(player),
    upNext: player.queue.tracks.slice(0, 3).map((t) => t.info?.title ?? 'Unknown'),
    queueLength: player.queue.tracks.length,
    lyricLine:
      synced && positionMs !== undefined ? (currentLine(synced, positionMs) ?? undefined) : undefined,
    autoplay: player.get<boolean>('autoplay') ?? false,
    filterName: player.get<string | undefined>('filter'),
    sponsorBlock: player.get<boolean>('sponsorblock') ?? false,
    nonStop: player.get<boolean>('247') ?? false,
  };
}

/** Map a card message to the track it shows, so its Favorite button targets THAT
 * track (not whatever is playing now). No-op when the track has no URL. */
function rememberCard(message: Message, track: Track): void {
  if (track.info.uri) {
    rememberCardTrack(message.id, {
      title: track.info.title,
      uri: track.info.uri,
      author: track.info.author,
    });
  }
}

/** Stop ticking a guild's card (it's finished/destroyed) — drops any pending
 * refresh from the update pipeline. The global scheduler also skips players that
 * aren't actively playing, so this is just prompt cleanup. */
function stopTicking(player: Player): void {
  clearPanelDirty(player.guildId);
}

/**
 * Synced lyrics for the card. With LYRICS_SOURCE=lavalink we ask the LavaLyrics
 * plugin through the node first (player.getCurrentLyrics) and map its timed
 * lines; on empty/error we fall back to the proven LRCLIB client. Default
 * ('lrclib') skips straight to LRCLIB — the original path, untouched.
 */
async function fetchCardLyrics(
  player: Player,
  author: string,
  title: string,
): Promise<SyncedLine[] | null> {
  if (config.plugins.lyricsSource === 'lavalink') {
    try {
      const res = await player.getCurrentLyrics();
      const lines = (res?.lines ?? [])
        .filter((l) => l.line)
        .map((l) => ({ t: l.timestamp, text: l.line }));
      if (lines.length) return lines;
    } catch {
      // plugin missing / no match → fall back to LRCLIB below
    }
  }
  return fetchSyncedLyrics(author, title);
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
    if (oldTrack) {
      // A buried/superseded card keeps a working Replay + Favorite (for ~30 min)
      // so EVERY track — not just the final one — stays favouritable after it goes.
      await greyPanel(existing, oldTrack, true);
      armPanelExpiry(existing);
    }
  }
  return channel.send(payload).catch((err) => {
    logger.warn({ err }, 'failed to send now-playing panel');
    return undefined;
  });
}

/**
 * Render one now-playing card edit (progress bar, modifier badges, lyric line).
 * This is the pipeline's worker — the panelScheduler calls it; it does NOT
 * throttle (the scheduler coalesces) and never throws. Nothing else should call
 * it directly: request a refresh with `markPanelDirty(player)` instead.
 */
async function renderPanel(player: Player): Promise<void> {
  const message = player.get<Message | undefined>('npMessage');
  const track = player.get<Track | undefined>('npTrack');
  if (!message || !track) return;

  const accentColor = await getAccentColor(track.info.artworkUrl);
  await message
    .edit({ ...V2, components: [nowPlayingCard(track, { ...panelOptions(player, player.position), accentColor })] })
    .catch(() => undefined);
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
  }, config.music.pauseTimeoutMs);
  player.set('pauseTimer', handle);
}

export function registerLavalinkEvents(client: ElfariaClient): void {
  // The single now-playing update pipeline: one loop edits every live card on
  // the configured cadence, coalescing command-driven bursts. Decoupled from
  // command handling so heavy traffic can't stall/spam the timer + lyrics.
  startPanelScheduler(renderPanel, () => client.lavalink.players.values());

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
      stopTicking(player);
      clearPauseTimer(player);
      // If the panel we're about to reuse had an expiry armed (e.g. after a
      // queue-end card), cancel it — this message is going live again.
      const prevPanel = player.get<Message | undefined>('npMessage');
      if (prevPanel) clearPanelExpiry(prevPanel.id);
      player.set('npFinished', false);

      // Fetch timed (synced) lyrics for the card — best-effort, off the hot path.
      player.set('syncedLyrics', undefined);
      if (track.info.title && !track.info.isStream) {
        void fetchCardLyrics(player, track.info.author ?? '', track.info.title).then((lines) => {
          // Only apply if this is still the track playing (the fetch is async).
          if (lines && player.queue.current?.info.identifier === track.info.identifier) {
            player.set('syncedLyrics', lines);
            markPanelDirty(player);
          }
        });
      }

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
        rememberCard(message, track);
        // The global panelScheduler ticks this card on the configured cadence
        // (it picks up any playing player with an npMessage) — no per-player timer.
        markPanelDirty(player);
        // Persist the live panel so it can be retired if this process dies before
        // the panel is cleanly greyed (crash/OOM/kill) — see panelStore.ts.
        void rememberPanel(player.guildId, message.channelId, message.id);
      }

      // Proactively top up the autoplay buffer so the picks appear in "up next"
      // WHILE the current track plays — not only once the queue swaps to them.
      if (player.get<boolean>('autoplay')) {
        void fillAutoplayBuffer(player, track).then((added) => {
          if (added > 0) markPanelDirty(player);
        });
      }
    })
    .on('queueEnd', async (player) => {
      logger.info({ guildId: player.guildId }, 'queue ended');
      stopTicking(player);

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
      if (message) {
        player.set('npMessage', message);
        rememberCard(message, track);
        armPanelExpiry(message); // grey Replay/Favorite after ~30 min
      }
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
      markPanelDirty(player);
    })
    .on('playerResumed', (player) => {
      clearPauseTimer(player);
      markPanelDirty(player);
    })
    .on('playerDisconnect', (player) => {
      logger.info({ guildId: player.guildId }, 'player disconnected from voice');
    })
    .on('SegmentSkipped', (player, _track, payload) => {
      // SponsorBlock skipped a non-music segment — surface it for observability.
      logger.debug(
        { guildId: player.guildId, category: payload.segment?.category },
        'sponsorblock segment skipped',
      );
    })
    .on('playerDestroy', (player) => {
      stopTicking(player);
      clearPauseTimer(player);
      // Autoplay is a session modifier — always reset it off when the bot leaves
      // so it never silently resumes auto-queuing on the next join. (The saved
      // value is cleared too; only modifier-persistence guilds restore others.)
      player.set('autoplay', false);
      void setAppSetting(autoplayKey(player.guildId), 'false').catch(() => undefined);
      // However the player goes away, the greyed card below is standalone-
      // functional, so the saved ref is no longer needed.
      void forgetPanel(player.guildId);
      // Drop the persisted queue on a normal stop/leave so it can't resurrect on
      // the next /play. In 24/7 mode we KEEP it so the auto-rejoin can restore it.
      if (!player.get<boolean>('247')) void dbQueueStore.delete(player.guildId);
      // queueEnd already rendered the final card (grey + Replay). For every other
      // way the player goes away — stop, pause-timeout, empty channel, idle leave —
      // grey the live panel AND keep a Replay button, so the card always greys out
      // and the last track can be brought back.
      if (player.get('npFinished')) return;
      const message = player.get<Message | undefined>('npMessage');
      const track = player.get<Track | undefined>('npTrack');
      player.set('npMessage', undefined);
      player.set('npTrack', undefined);
      if (message && track) {
        rememberCard(message, track);
        void greyPanel(message, track, true);
        armPanelExpiry(message); // expire Replay/Favorite after ~30 min
      }
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
