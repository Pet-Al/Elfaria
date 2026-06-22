import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  SectionBuilder,
  SeparatorBuilder,
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
 *     accent-bordered container: a text block with the artwork as a compact
 *     thumbnail accessory beside it, an optional live progress bar, a divider,
 *     and the control buttons.
 *   - nowPlayingEmbed() — the classic embed kept for `/nowplaying legacy:true`.
 *
 * Keeping both here means the styling lives in one place and the two callers
 * (player.ts auto-panel, /nowplaying) can't drift apart.
 */

const ACCENT = 0x5865f2;
const BAR_SIZE = 18;

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

export interface CardOptions {
  /** Grey out the control buttons (retired panel). */
  disabled?: boolean;
  /** Current playback position (ms). When set, renders a live progress bar. */
  positionMs?: number;
  /** Attach the control buttons. The auto-panel does; a `/nowplaying` snapshot doesn't. */
  withControls?: boolean;
}

/** The modern Components V2 now-playing card. Send with MessageFlags.IsComponentsV2. */
export function nowPlayingCard(track: Track, options: CardOptions = {}): ContainerBuilder {
  const { disabled = false, positionMs, withControls = true } = options;
  const requester = track.requester as { username?: string } | undefined;
  const live = positionMs !== undefined;
  const duration = track.info.isStream ? 'live' : formatDuration(track.info.duration);

  // Header text. Duration appears in exactly one place: inline here when there's
  // no progress bar, otherwise the progress bar carries it (position / duration).
  const header = ['### ▶️ Now playing', `**[${track.info.title}](${track.info.uri})**`];
  const author = track.info.author || 'Unknown';
  header.push(live ? `🎤 ${author}` : `🎤 ${author}  •  ⏱️ ${duration}`);
  if (requester?.username) header.push(`-# Requested by ${requester.username}`);

  const container = new ContainerBuilder().setAccentColor(ACCENT);

  // Compact square thumbnail beside the text (a Section accessory). A Section
  // requires an accessory, so when there's no artwork the text goes straight
  // into the container instead.
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

  if (withControls) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addActionRowComponents(controlRow(disabled));
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
