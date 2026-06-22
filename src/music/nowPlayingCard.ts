import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from 'discord.js';
import type { Track } from 'lavalink-client';
import { formatDuration } from './QueueManager.js';

/**
 * Now-playing card builders (doc roadmap, "rich UI").
 *
 * Two renderings of the same track:
 *   - nowPlayingCard()  — the modern Components V2 layout (the default). An
 *     accent-bordered container: a text block (title, artist, source badge,
 *     volume/loop state, "up next") with the artwork as a compact thumbnail
 *     accessory, an optional live progress bar, a divider, the control buttons,
 *     and an optional volume dropdown.
 *   - nowPlayingEmbed() — the classic embed kept for `/nowplaying legacy:true`.
 *
 * Keeping both here means the styling lives in one place and the callers
 * (player.ts auto-panel, /nowplaying) can't drift apart.
 */

const ACCENT = 0x5865f2;
const BAR_SIZE = 18;

/** Volume presets offered by the np:volume dropdown. */
export const VOLUME_PRESETS = [0, 25, 50, 75, 100, 125, 150, 200];

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

function repeatBadge(mode?: string): string | null {
  if (mode === 'track') return '🔂 Loop: track';
  if (mode === 'queue') return '🔁 Loop: queue';
  return null;
}

/** A textual progress bar for the current position within a track. */
export function progressBar(positionMs: number, durationMs: number): string {
  if (!durationMs || durationMs <= 0) return '🔴 LIVE';
  const ratio = Math.min(positionMs / durationMs, 1);
  const filled = Math.round(ratio * BAR_SIZE);
  const bar = '▬'.repeat(filled) + '🔘' + '▬'.repeat(Math.max(BAR_SIZE - filled, 0));
  return `${bar}\n\`${formatDuration(positionMs)} / ${formatDuration(durationMs)}\``;
}

/**
 * The five playback control buttons (handled in events/buttons.ts). `disabled`
 * greys them out — used to retire a previous song's panel so old messages stop
 * responding (Discord components never expire on their own).
 */
export function controlRow(disabled = false): ActionRowBuilder<ButtonBuilder> {
  const button = (id: string, emoji: string, style: ButtonStyle): ButtonBuilder =>
    new ButtonBuilder().setCustomId(id).setEmoji(emoji).setStyle(style).setDisabled(disabled);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    button('np:playpause', '⏯️', ButtonStyle.Secondary),
    button('np:skip', '⏭️', ButtonStyle.Secondary),
    button('np:stop', '⏹️', ButtonStyle.Danger),
    button('np:shuffle', '🔀', ButtonStyle.Secondary),
    button('np:queue', '📜', ButtonStyle.Secondary),
  );
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

export interface CardOptions {
  /** Grey out the controls (retired panel). */
  disabled?: boolean;
  /** Current playback position (ms). When set, renders a live progress bar. */
  positionMs?: number;
  /** Attach the control buttons. The auto-panel does; a `/nowplaying` snapshot doesn't. */
  withControls?: boolean;
  /** Attach the volume dropdown (only meaningful with controls). */
  withVolumeSelect?: boolean;
  /** Current player volume — shows a 🔊 indicator and pre-selects the dropdown. */
  volume?: number;
  /** Player repeat mode (off|track|queue) — shows a 🔁 indicator when not off. */
  repeatMode?: string;
  /** Titles of the upcoming tracks — renders an "Up next" block. */
  upNext?: string[];
  /** Total upcoming count, for the "+N more" hint. */
  queueLength?: number;
}

/** The modern Components V2 now-playing card. Send with MessageFlags.IsComponentsV2. */
export function nowPlayingCard(track: Track, options: CardOptions = {}): ContainerBuilder {
  const {
    disabled = false,
    positionMs,
    withControls = true,
    withVolumeSelect = false,
    volume,
    repeatMode,
    upNext,
    queueLength,
  } = options;
  const requester = track.requester as { username?: string } | undefined;
  const live = positionMs !== undefined;

  // Meta line: artist • duration (when no progress bar) • source badge.
  const meta = [`🎤 ${track.info.author || 'Unknown'}`];
  if (!live) meta.push(`⏱️ ${track.info.isStream ? 'live' : formatDuration(track.info.duration)}`);
  const badge = SOURCE_BADGES[track.info.sourceName ?? ''] ?? track.info.sourceName;
  if (badge) meta.push(badge);

  const header = ['### ▶️ Now playing', `**[${track.info.title}](${track.info.uri})**`, meta.join('  •  ')];

  // State line: volume + loop, only what's known.
  const state: string[] = [];
  if (volume !== undefined) state.push(`🔊 ${volume}%`);
  const loop = repeatBadge(repeatMode);
  if (loop) state.push(loop);
  if (state.length) header.push(state.join('    '));

  if (requester?.username) header.push(`-# Requested by ${requester.username}`);

  const container = new ContainerBuilder().setAccentColor(ACCENT);

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

  if (live) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(progressBar(positionMs, track.info.duration)),
    );
  }

  if (upNext && upNext.length > 0) {
    const list = upNext.slice(0, 3).map((title, i) => `\`${i + 1}.\` ${title}`).join('\n');
    const total = queueLength ?? upNext.length;
    const more = total > 3 ? `\n-# +${total - 3} more in queue` : '';
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**Up next**\n${list}${more}`),
    );
  }

  if (withControls) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addActionRowComponents(controlRow(disabled));
    if (withVolumeSelect) container.addActionRowComponents(volumeSelectRow(volume, disabled));
  }

  return container;
}

/** The classic embed view, kept for `/nowplaying legacy:true`. */
export function nowPlayingEmbed(track: Track, positionMs?: number): EmbedBuilder {
  const requester = track.requester as { id?: string; username?: string } | undefined;
  const description =
    positionMs !== undefined
      ? `**[${track.info.title}](${track.info.uri})**\n\n${progressBar(positionMs, track.info.duration)}`
      : `**[${track.info.title}](${track.info.uri})**`;
  return new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle('🎶 Now playing')
    .setDescription(description)
    .addFields(
      { name: 'Author', value: track.info.author || 'Unknown', inline: true },
      {
        name: 'Requested by',
        value: requester?.id ? `<@${requester.id}>` : (requester?.username ?? 'Unknown'),
        inline: true,
      },
    )
    .setThumbnail(track.info.artworkUrl);
}
