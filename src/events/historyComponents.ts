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
import type { ElfariaClient } from '../client.js';
import { countHistory, getHistoryPage, getLastPlayed } from '../db/history.js';
import { logger } from '../lib/logger.js';
import { ensurePlayer } from '../music/QueueManager.js';
import { resolve } from '../music/sources.js';

/**
 * Components for /history (paginated, unlimited) and /replay (pick from history).
 *
 * History is rendered 10 per page with Prev/Next buttons and a jump-to-page
 * dropdown (Discord caps a select at 25 options, so the dropdown lists up to 25
 * pages — buttons reach the rest). All state is encoded in custom ids, so the
 * handlers are stateless and just re-render on update.
 */

const PER_PAGE = 10;
const MAX_PAGES_IN_DROPDOWN = 25;
const MAX_REPLAY_OPTIONS = 25;
/** Discord select option value limit. */
const VALUE_MAX = 100;

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
    .setFooter({ text: `Page ${p + 1}/${totalPages} • ${total} tracks • replay with /replay` });

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

  return { embeds: [embed], components: [nav, jumpRow], flags: MessageFlags.Ephemeral };
}

/** Build the /replay picker: a "replay most recent" button + a recent-tracks dropdown. */
export async function buildReplayPicker(guildId: string): Promise<InteractionReplyOptions | null> {
  const recent = await getHistoryPage(guildId, 0, MAX_REPLAY_OPTIONS);
  if (recent.length === 0) return null;

  const button = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('replay:last')
      .setEmoji('↩️')
      .setLabel('Replay most recent')
      .setStyle(ButtonStyle.Primary),
  );

  // Select values carry the track URI; skip any URI too long for a select value.
  const options = recent
    .filter((e) => e.uri.length <= VALUE_MAX)
    .slice(0, MAX_REPLAY_OPTIONS)
    .map((e, i) => {
      const opt = new StringSelectMenuOptionBuilder()
        .setLabel(e.title.slice(0, 100))
        .setValue(e.uri);
      if (e.author) opt.setDescription(e.author.slice(0, 100));
      if (i === 0) opt.setDefault(true); // the most recent is the default
      return opt;
    });
  const select = new StringSelectMenuBuilder()
    .setCustomId('replay:pick')
    .setPlaceholder('…or pick a recent track to replay')
    .addOptions(options);

  return {
    content: '↩️ Replay the most recent track, or pick one from your recent history:',
    components: [button, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  };
}

/** Re-queue a track by URI from a component interaction (shared by both replay paths). */
async function replayUri(
  interaction: ButtonInteraction<'cached'> | StringSelectMenuInteraction<'cached'>,
  uri: string,
  fallbackTitle: string,
): Promise<void> {
  const voiceChannelId = interaction.member.voice.channelId;
  if (!voiceChannelId) {
    await interaction.reply({ content: '❌ Join a voice channel first.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({ content: `↩️ Loading **${fallbackTitle}**…`, flags: MessageFlags.Ephemeral });
  try {
    const client = interaction.client as ElfariaClient;
    const player = await ensurePlayer(client, interaction.guildId, voiceChannelId, interaction.channelId);
    const result = await resolve(player, uri, interaction.user);
    const track = result.tracks[0];
    if (!track) {
      await interaction.editReply(`❌ Couldn't reload **${fallbackTitle}**.`);
      return;
    }
    player.queue.add(track);
    if (!player.playing && !player.paused) await player.play();
    await interaction.editReply(`↩️ Replaying **${track.info.title}**.`);
  } catch (err) {
    logger.error({ err, guildId: interaction.guildId }, 'replay (picker) failed');
    await interaction.editReply('❌ Something went wrong replaying that.');
  }
}

/** Button handler for hist:page:* (pagination) and replay:last. */
export async function handleHistoryButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) return;

  if (interaction.customId.startsWith('hist:page:')) {
    const page = Number.parseInt(interaction.customId.slice('hist:page:'.length), 10) || 0;
    const view = await buildHistoryView(interaction.guildId, page);
    if (view) await interaction.update({ embeds: view.embeds, components: view.components });
    return;
  }

  if (interaction.customId === 'replay:last') {
    const last = await getLastPlayed(interaction.guildId);
    if (!last) {
      await interaction.reply({ content: '❌ Nothing recent to replay.', flags: MessageFlags.Ephemeral });
      return;
    }
    await replayUri(interaction, last.uri, last.title);
  }
}

/** Select handler for hist:select (jump page) and replay:pick. */
export async function handleHistorySelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) return;

  if (interaction.customId === 'hist:select') {
    const page = Number.parseInt(interaction.values[0] ?? '0', 10) || 0;
    const view = await buildHistoryView(interaction.guildId, page);
    if (view) await interaction.update({ embeds: view.embeds, components: view.components });
    return;
  }

  if (interaction.customId === 'replay:pick') {
    const uri = interaction.values[0];
    if (!uri) {
      await interaction.reply({ content: '❌ No track selected.', flags: MessageFlags.Ephemeral });
      return;
    }
    await replayUri(interaction, uri, 'that track');
  }
}
