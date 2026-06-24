import {
  ActionRowBuilder,
  type ButtonInteraction,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type InteractionReplyOptions,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js';
import type { Player, Track } from 'lavalink-client';
import type { ElfariaClient } from '../client.js';
import { formatDuration } from '../music/QueueManager.js';

/**
 * Interactive, paginated /queue view (Prev/Next + jump-to-page dropdown). Reads
 * the LIVE player each render (the queue is in-memory state, not the DB), so the
 * page stays current as tracks come and go. Custom-id prefix: `q:`.
 */
const PER_PAGE = 10;
const MAX_PAGES_IN_DROPDOWN = 25;

/** Build the embed + nav components for one queue page (0-based). Null if empty. */
export function buildQueueView(player: Player, page: number): InteractionReplyOptions | null {
  const tracks = player.queue.tracks as Track[];
  const current = player.queue.current;
  if (!current && tracks.length === 0) return null;

  const totalPages = Math.max(1, Math.ceil(tracks.length / PER_PAGE));
  const p = Math.max(0, Math.min(page, totalPages - 1));
  const slice = tracks.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE);
  const lines = slice.map((t, i) => {
    const length = t.info.isStream ? 'live' : formatDuration(t.info.duration);
    return `\`${p * PER_PAGE + i + 1}.\` [${t.info.title}](${t.info.uri}) \`${length}\``;
  });

  const nowPlaying = current ? `**Now playing:** [${current.info.title}](${current.info.uri})\n` : '';
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🎵 Queue')
    .setDescription(`${nowPlaying}\n${lines.length ? lines.join('\n') : '*No upcoming tracks.*'}`)
    .setFooter({
      text: `Page ${p + 1}/${totalPages} • ${tracks.length} in queue • repeat: ${player.repeatMode}`,
    });

  const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`q:page:${p - 1}`)
      .setLabel('◀ Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(p === 0),
    new ButtonBuilder()
      .setCustomId(`q:page:${p + 1}`)
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(p >= totalPages - 1),
  );

  const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [nav];
  if (totalPages > 1) {
    const pageCount = Math.min(totalPages, MAX_PAGES_IN_DROPDOWN);
    const jump = new StringSelectMenuBuilder()
      .setCustomId('q:select')
      .setPlaceholder(`Jump to page (1–${pageCount})`)
      .addOptions(
        Array.from({ length: pageCount }, (_, i) => {
          const opt = new StringSelectMenuOptionBuilder().setLabel(`Page ${i + 1}`).setValue(String(i));
          if (i === p) opt.setDefault(true);
          return opt;
        }),
      );
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(jump));
  }

  return { embeds: [embed], components };
}

async function rerender(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  page: number,
): Promise<void> {
  if (!interaction.inCachedGuild()) return;
  const player = (interaction.client as ElfariaClient).lavalink.getPlayer(interaction.guildId);
  const view = player ? buildQueueView(player, page) : null;
  if (!view) {
    await interaction.update({ embeds: [], components: [], content: '🎵 The queue is now empty.' });
    return;
  }
  await interaction.update({ embeds: view.embeds, components: view.components });
}

export async function handleQueueButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.customId.startsWith('q:page:')) return;
  await rerender(interaction, Number.parseInt(interaction.customId.slice('q:page:'.length), 10) || 0);
}

export async function handleQueueSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (interaction.customId !== 'q:select') return;
  await rerender(interaction, Number.parseInt(interaction.values[0] ?? '0', 10) || 0);
}
