import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { replyError } from '../lib/interactions.js';
import { logger } from '../lib/logger.js';
import type { Command } from '../lib/types.js';
import { getPlayer } from '../music/QueueManager.js';

/**
 * /lyrics — best-effort lyrics for the current track.
 *
 * Uses the free, keyless lyrics.ovh API (artist + title) rather than a Lavalink
 * lyrics plugin: it needs no extra plugin and can't break Lavalink's boot (a
 * recurring pain when plugin versions don't match). Trade-off: plain text only,
 * no time-synced lines, and coverage depends on the API. Fail-soft throughout.
 */

/** Strip the noise YouTube/SoundCloud titles add so the lyrics lookup matches. */
function clean(input: string): string {
  return input
    .replace(/\([^)]*\)/g, '') // (Official Video)
    .replace(/\[[^\]]*\]/g, '') // [Audio]
    .replace(/\bfeat\.?.*$/i, '') // feat. …
    .replace(/\b(official|lyrics?|audio|video|music video|hd|4k|visualizer|mv)\b/gi, '')
    .replace(/[-|–]+\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

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
    const artist = clean((current.info.author ?? '').replace(/ - Topic$/i, ''));
    const title = clean(current.info.title ?? '');

    try {
      const res = await fetch(
        `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
        { signal: AbortSignal.timeout(8000) },
      );
      const data = res.ok ? ((await res.json()) as { lyrics?: string }) : null;
      const text = data?.lyrics?.trim();
      if (!text) {
        await replyError(interaction, `Couldn't find lyrics for **${current.info.title}**.`);
        return;
      }

      const body = text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🎤 ${current.info.title}`.slice(0, 256))
        .setDescription(body)
        .setFooter({ text: 'Lyrics via lyrics.ovh' });
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.warn({ err, track: current.info.title }, 'lyrics fetch failed');
      await replyError(interaction, 'The lyrics service is unavailable right now.');
    }
  },
};
