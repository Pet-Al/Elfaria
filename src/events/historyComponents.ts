import {
  ActionRowBuilder,
  type ButtonInteraction,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type InteractionReplyOptions,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { countHistory, getHistoryPage } from '../db/history.js';

/**
 * Components for /history (paginated, unlimited). History is rendered 10 per
 * page; the jump-to-page dropdown is on the FIRST row and Prev/Next on the
 * second. Discord caps a select at 25 options, so the dropdown lists up to 25
 * pages — the buttons reach the rest. State lives in the custom ids, so the
 * handlers are stateless and just re-render on update. (Replay is a plain
 * /replay <position> command — no picker.)
 */

const PER_PAGE = 10;
const MAX_PAGES_IN_DROPDOWN = 25;

/** Build the embed + nav components for one history page (0-based). */
export async function buildHistoryView(
  guildId: string,
  page: number,
): Promise<InteractionReplyOptions | null> {
  const total = await countHistory(guildId);
  if (total === 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const p = Math.max(0, Math.min(page, totalPages - 1));
  const entries = await getHistoryPage(guildId, p, PER_PAGE);
  const start = p * PER_PAGE;

  const lines = entries.map(
    (e, i) => `\`${start + i + 1}.\` [${e.title}](${e.uri})${e.author ? ` — ${e.author}` : ''}`,
  );
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🕑 Recently played')
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Page ${p + 1}/${totalPages} • ${total} tracks • replay with /replay <#>` });

  const pageCount = Math.min(totalPages, MAX_PAGES_IN_DROPDOWN);
  const jump = new StringSelectMenuBuilder()
    .setCustomId('hist:select')
    .setPlaceholder(`Jump to page (1–${pageCount})`)
    .addOptions(
      Array.from({ length: pageCount }, (_, i) => {
        const opt = new StringSelectMenuOptionBuilder().setLabel(`Page ${i + 1}`).setValue(String(i));
        if (i === p) opt.setDefault(true);
        return opt;
      }),
    );
  const jumpRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(jump);

  const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`hist:page:${p - 1}`)
      .setLabel('◀ Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(p === 0),
    new ButtonBuilder()
      .setCustomId(`hist:page:${p + 1}`)
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(p >= totalPages - 1),
  );

  // Dropdown first, buttons second (per request).
  return { embeds: [embed], components: [jumpRow, nav], flags: MessageFlags.Ephemeral };
}

/** Button handler for hist:page:* (pagination). */
export async function handleHistoryButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inCachedGuild() || !interaction.customId.startsWith('hist:page:')) return;
  const page = Number.parseInt(interaction.customId.slice('hist:page:'.length), 10) || 0;
  const view = await buildHistoryView(interaction.guildId, page);
  if (view) await interaction.update({ embeds: view.embeds, components: view.components });
}

/** Select handler for hist:select (jump to page). */
export async function handleHistorySelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.inCachedGuild() || interaction.customId !== 'hist:select') return;
  const page = Number.parseInt(interaction.values[0] ?? '0', 10) || 0;
  const view = await buildHistoryView(interaction.guildId, page);
  if (view) await interaction.update({ embeds: view.embeds, components: view.components });
}
