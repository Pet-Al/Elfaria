import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from 'discord.js';
import type { Track } from 'lavalink-client';
import { type LoopState, loopLabel } from './loop.js';
import { formatDuration } from './QueueManager.js';

/**
 * Now-playing card builder (doc roadmap, "rich UI").
 *
 * A single Components V2 container: a text block (title, artist, source badge,
 * volume/loop state, "up next") with the artwork as a compact thumbnail
 * accessory, an artwork-tinted accent, an optional live progress bar, a divider,
 * and the controls (transport buttons; a compact row of volume −/+ and ⭐
 * favorite; a loop dropdown). A buried panel is fully greyed; the FINAL panel
 * shown when the queue finishes adds a Replay button.
 */

const ACCENT = 0x5865f2;
const BAR_SIZE = 18;

/** Volume presets offered by the np:volume dropdown (25 increments + boost). */
export const VOLUME_PRESETS = [0, 25, 50, 75, 100, 125, 150, 200];

/** Loop options offered by the np:loop dropdown. */
const LOOP_OPTIONS: { value: LoopState; label: string; emoji: string }[] = [
  { value: 'off', label: 'No loop', emoji: '➡️' },
  { value: 'track-once', label: 'Track — once more', emoji: '🔂' },
  { value: 'track', label: 'Track — infinite', emoji: '🔂' },
  { value: 'queue-once', label: 'Queue — one more lap', emoji: '🔁' },
  { value: 'queue', label: 'Queue — infinite', emoji: '🔁' },
];

/** Human label + emoji for each audio source. */
const SOURCE_BADGES: Record<string, string> = {
  youtube: '📺 YouTube',
  youtubemusic: '📺 YouTube Music',
  spotify: '🟢 Spotify',
  soundcloud: '🟠 SoundCloud',
  applemusic: '🍎 Apple Music',
  deezer: '🟣 Deezer',
  bandcamp: '🔵 Bandcamp',
  twitch: '🟪 Twitch',
  vimeo: '🎬 Vimeo',
  http: '🔗 Direct link',
};

function loopBadge(state?: string): string | null {
  if (!state || state === 'off') return null;
  const emoji = state.startsWith('track') ? '🔂' : '🔁';
  return `${emoji} ${loopLabel(state as LoopState)}`;
}

/**
 * A textual progress bar for the current position within a track. Live streams
 * (and tracks with no known duration) show 🔴 LIVE instead of a bar.
 */
export function progressBar(positionMs: number, durationMs: number, isStream = false): string {
  if (isStream || !durationMs || durationMs <= 0) return '🔴 LIVE';
  const ratio = Math.min(positionMs / durationMs, 1);
  const filled = Math.round(ratio * BAR_SIZE);
  const bar = '▬'.repeat(filled) + '🔘' + '▬'.repeat(Math.max(BAR_SIZE - filled, 0));
  return `${bar}\n\`${formatDuration(positionMs)} / ${formatDuration(durationMs)}\``;
}

/**
 * The five playback transport buttons (handled in events/buttons.ts). Back is on
 * the left of play/pause. `disabled` greys them out — used to retire a previous
 * song's panel so old messages stop responding (Discord components never expire
 * on their own).
 */
export function controlRow(disabled = false): ActionRowBuilder<ButtonBuilder> {
  const button = (id: string, emoji: string, style: ButtonStyle): ButtonBuilder =>
    new ButtonBuilder().setCustomId(id).setEmoji(emoji).setStyle(style).setDisabled(disabled);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    button('np:back', '⏮️', ButtonStyle.Secondary),
    button('np:playpause', '⏯️', ButtonStyle.Secondary),
    button('np:skip', '⏭️', ButtonStyle.Secondary),
    button('np:stop', '⏹️', ButtonStyle.Danger),
    button('np:queue', '📜', ButtonStyle.Secondary),
  );
}

/** The live card's utility row: ⭐ Favorite + 🔀 Shuffle + ↩️ Replay. */
export function utilityRow(disabled = false): ActionRowBuilder<ButtonBuilder> {
  const button = (id: string, emoji: string, label: string): ButtonBuilder =>
    new ButtonBuilder()
      .setCustomId(id)
      .setEmoji(emoji)
      .setLabel(label)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    button('np:favorite', '⭐', 'Favorite'),
    button('np:shuffle', '🔀', 'Shuffle'),
    button('np:replay', '↩️', 'Replay'),
  );
}

/** The loop dropdown (handled in events/buttons.ts as customId np:loop). */
export function loopSelectRow(
  current?: string,
  disabled = false,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const state = (current ?? 'off') as LoopState;
  const select = new StringSelectMenuBuilder()
    .setCustomId('np:loop')
    .setPlaceholder(
      state === 'off'
        ? '🔁 Loop: off'
        : `${state.startsWith('track') ? '🔂' : '🔁'} ${loopLabel(state)}`,
    )
    .setDisabled(disabled)
    .addOptions(
      LOOP_OPTIONS.map((o) => {
        const option = new StringSelectMenuOptionBuilder()
          .setLabel(o.label)
          .setValue(o.value)
          .setEmoji(o.emoji);
        if (o.value === state) option.setDefault(true);
        return option;
      }),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

/** The volume dropdown (handled in events/buttons.ts as customId np:volume). */
export function volumeSelectRow(
  current?: number,
  disabled = false,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const select = new StringSelectMenuBuilder()
    .setCustomId('np:volume')
    .setPlaceholder(current === undefined ? '🔊 Set volume' : `🔊 Volume — ${current}%`)
    .setDisabled(disabled)
    .addOptions(
      VOLUME_PRESETS.map((v) => {
        const option = new StringSelectMenuOptionBuilder()
          .setLabel(v === 0 ? 'Mute (0%)' : `${v}%`)
          .setValue(String(v))
          .setEmoji(v === 0 ? '🔇' : v <= 75 ? '🔉' : v <= 100 ? '🔊' : '📢');
        if (current !== undefined && v === current) option.setDefault(true);
        return option;
      }),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

/** Most options a Discord select may hold is 25; keep a little headroom. */
const SEEK_MAX_MARKS = 24;

/**
 * Dynamic seek dropdown (handled in events/buttons.ts as customId np:seek).
 *
 * Offers evenly-spaced jump points from the start of the track to its end. The
 * step is the smallest multiple of 10 seconds that keeps the number of marks
 * within Discord's 25-option select limit — so a 3-minute song gets 10s steps
 * while a 2-hour set gets coarser ones, and either way it fits. Streams and
 * tracks with no known duration get no seek control (you can't seek a live
 * stream), so this returns null for them.
 */
export function seekSelectRow(
  track: Track,
  positionMs?: number,
  disabled = false,
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  const durationMs = track.info.duration;
  if (track.info.isStream || !durationMs || durationMs <= 0) return null;

  const durationSec = Math.floor(durationMs / 1000);
  // Smallest 10s multiple s.t. floor(duration/step)+1 ≤ SEEK_MAX_MARKS marks.
  const stepSec = Math.max(10, Math.ceil(durationSec / (SEEK_MAX_MARKS - 1) / 10) * 10);

  const marks: number[] = [];
  for (let s = 0; s <= durationSec && marks.length < SEEK_MAX_MARKS; s += stepSec) {
    marks.push(s * 1000);
  }
  if (marks.length < 2) return null; // too short to offer meaningful jumps

  const position = positionMs ?? 0;
  const select = new StringSelectMenuBuilder()
    .setCustomId('np:seek')
    .setPlaceholder(`⏩ Jump to… (${formatDuration(stepSec * 1000)} steps)`)
    .setDisabled(disabled)
    .addOptions(
      marks.map((ms, i) => {
        const next = marks[i + 1] ?? durationMs + 1;
        const option = new StringSelectMenuOptionBuilder()
          .setLabel(formatDuration(ms))
          .setValue(String(ms))
          .setEmoji(ms === 0 ? '⏮️' : '⏱️');
        // Pre-select the mark covering the current position.
        if (position >= ms && position < next) option.setDefault(true);
        return option;
      }),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

/**
 * A finished/expired card's live controls: ↩️ Replay + ⭐ Favorite. Both keep
 * working with no active player — they re-resolve the last-played track — so an
 * expired card still lets you replay or favorite the song that was on it.
 */
export function endedRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('np:replay')
      .setEmoji('↩️')
      .setLabel('Replay')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('np:favorite')
      .setEmoji('⭐')
      .setLabel('Favorite')
      .setStyle(ButtonStyle.Secondary),
  );
}

export interface CardOptions {
  /** Grey out the controls (a buried or finished panel). */
  disabled?: boolean;
  /** When disabled, also attach an active Replay button (the final/finished panel). */
  withReplay?: boolean;
  /** Current playback position (ms). When set, renders a live progress bar. */
  positionMs?: number;
  /** Attach the controls. The auto-panel does; a `/nowplaying` snapshot doesn't. */
  withControls?: boolean;
  /** Container accent colour (e.g. extracted from the artwork). Defaults to brand. */
  accentColor?: number;
  /** Current player volume — shows a 🔊 indicator in the state line. */
  volume?: number;
  /** Loop state (off|track-once|track|queue-once|queue) — drives the 🔁 indicator/dropdown. */
  loopState?: string;
  /** Titles of the upcoming tracks — renders an "Up next" block. */
  upNext?: string[];
  /** Total upcoming count, for the "+N more" hint. */
  queueLength?: number;
  /** The current line of synced lyrics (LRCLIB), shown under the progress bar. */
  lyricLine?: string;
  /** Active modifiers — rendered as a compact badge row (autoplay/filter/etc.). */
  autoplay?: boolean;
  /** Active filter/EQ preset name (e.g. "bassboost"), if any. */
  filterName?: string;
  /** SponsorBlock segment-skipping enabled. */
  sponsorBlock?: boolean;
  /** 24/7 mode (the bot stays in voice). */
  nonStop?: boolean;
}

/** Build the modifier badge line (autoplay / filter / sponsorblock / 24-7). */
function modifierBadges(options: CardOptions): string | null {
  const badges: string[] = [];
  if (options.autoplay) badges.push('♾️ Autoplay');
  if (options.filterName) badges.push(`🎛️ ${options.filterName}`);
  if (options.sponsorBlock) badges.push('⏭️ SponsorBlock');
  if (options.nonStop) badges.push('📌 24/7');
  return badges.length ? `-# ${badges.join('  ·  ')}` : null;
}

/** The modern Components V2 now-playing card. Send with MessageFlags.IsComponentsV2. */
export function nowPlayingCard(track: Track, options: CardOptions = {}): ContainerBuilder {
  const {
    disabled = false,
    withReplay = false,
    positionMs,
    withControls = true,
    accentColor = ACCENT,
    volume,
    loopState,
    upNext,
    queueLength,
    lyricLine,
  } = options;
  const requester = track.requester as { username?: string } | undefined;
  const withProgress = positionMs !== undefined;

  // Meta line: artist • duration (or 🔴 Live for streams) • source badge.
  const meta = [`🎤 ${track.info.author || 'Unknown'}`];
  if (!withProgress) {
    if (track.info.isStream) meta.push('🔴 Live');
    else if (track.info.duration > 0) meta.push(`⏱️ ${formatDuration(track.info.duration)}`);
  }
  const badge = SOURCE_BADGES[track.info.sourceName ?? ''] ?? track.info.sourceName;
  if (badge) meta.push(badge);

  const header = [
    '### ▶️ Now playing',
    `**[${track.info.title}](${track.info.uri})**`,
    meta.join('  •  '),
  ];

  // State line: volume + loop, only what's known.
  const state: string[] = [];
  if (volume !== undefined) state.push(`🔊 ${volume}%`);
  const loop = loopBadge(loopState);
  if (loop) state.push(loop);
  if (state.length) header.push(state.join('    '));

  // Active modifiers (autoplay / filter / sponsorblock / 24-7) in the tags area.
  const badges = modifierBadges(options);
  if (badges) header.push(badges);

  if (requester?.username) header.push(`-# Requested by ${requester.username}`);

  const container = new ContainerBuilder().setAccentColor(accentColor);

  // Compact square thumbnail beside the text (a Section accessory). A Section
  // requires an accessory, so when there's no artwork the text goes straight in.
  if (track.info.artworkUrl) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(header.join('\n')))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(track.info.artworkUrl)),
    );
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(header.join('\n')));
  }

  if (withProgress) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        progressBar(positionMs, track.info.duration, track.info.isStream),
      ),
    );
  }

  // Current synced-lyrics line (LRCLIB), updated on each card refresh.
  if (lyricLine) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`🎤 *${lyricLine.slice(0, 180)}*`),
    );
  }

  if (upNext && upNext.length > 0) {
    const list = upNext
      .slice(0, 3)
      .map((title, i) => `\`#${i + 1}\` ${title}`)
      .join('\n');
    const total = queueLength ?? upNext.length;
    const more = total > 3 ? `\n-# +${total - 3} more in queue` : '';
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**Up next**\n${list}${more}`),
    );
  }

  if (withControls) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addActionRowComponents(controlRow(disabled));
    if (!disabled) {
      container.addActionRowComponents(utilityRow(false));
      container.addActionRowComponents(loopSelectRow(loopState, false));
      container.addActionRowComponents(volumeSelectRow(volume, false));
      // Seek is only meaningful for a track with a known, finite duration; it's
      // omitted for live streams (and brings the card to its 5-row max otherwise).
      const seek = seekSelectRow(track, positionMs, false);
      if (seek) container.addActionRowComponents(seek);
    } else if (withReplay) {
      // The final/expired panel: greyed transport, but Replay + Favorite stay live.
      container.addActionRowComponents(endedRow());
    }
  }

  return container;
}
