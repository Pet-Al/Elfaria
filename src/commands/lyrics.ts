import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { replyError } from '../lib/interactions.js';
import { type LyricsResult, fetchLyrics } from '../lib/lyrics.js';
import { logger } from '../lib/logger.js';
import type { Command } from '../lib/types.js';
import { getPlayer } from '../music/QueueManager.js';

/**
 * /lyrics — best-effort lyrics for the current track via LRCLIB (lrclib.net).
 * The fetch (and the synced-lyrics variant on the now-playing card) live in
 * lib/lyrics.ts. Distinguishes found / not-found / service-error so the message
 * is always accurate.
 */
export const lyrics: Command = {
  data: new SlashCommandBuilder()
    .setName('lyrics')
    .setDescription('Show lyrics for the current track.'),
  async execute(interaction) {
    const player = getPlayer(interaction);
    const current = player?.queue.current;
    if (!current) {
      await replyError(interaction, 'Nothing is playing.');
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let result: LyricsResult;
    try {
      result = await fetchLyrics(current.info.author ?? '', current.info.title ?? '');
    } catch (err) {
      logger.warn({ err, track: current.info.title }, 'lyrics fetch threw unexpectedly');
      result = { status: 'error' };
    }

    if (result.status === 'error') {
      await replyError(
        interaction,
        'The lyrics service (LRCLIB) is unavailable right now — please try again shortly.',
      );
      return;
    }
    if (result.status === 'not-found') {
      await replyError(
        interaction,
        `No lyrics found for **${current.info.title}** — LRCLIB may not have this track ` +
          '(common for remixes, live versions, and non-music audio).',
      );
      return;
    }

    const body = result.text.length > 4000 ? `${result.text.slice(0, 4000)}…` : result.text;
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`🎤 ${current.info.title}`.slice(0, 256))
      .setDescription(body)
      .setFooter({ text: 'Lyrics via LRCLIB' });
    await interaction.editReply({ embeds: [embed] });
  },
};
