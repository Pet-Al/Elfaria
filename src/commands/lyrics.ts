import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { replyError } from '../lib/interactions.js';
import { logger } from '../lib/logger.js';
import type { Command } from '../lib/types.js';
import { getPlayer } from '../music/QueueManager.js';

/**
 * /lyrics — best-effort lyrics for the current track via LRCLIB (lrclib.net):
 * a free, keyless, community lyrics database. No Lavalink plugin (so it can't
 * break Lavalink's boot), and far more reliable than lyrics.ovh. Tries an exact
 * artist+track match, then falls back to a search. Fail-soft throughout.
 */

const UA = 'Elfaria (+https://github.com/Pet-Al/Elfaria)';

interface LrcEntry {
  plainLyrics?: string | null;
  trackName?: string;
  artistName?: string;
}

/** Strip the noise YouTube/SoundCloud titles add so the lookup matches. */
function clean(input: string): string {
  return input
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\bfeat\.?.*$/i, '')
    .replace(/\b(official|lyrics?|audio|video|music video|hd|4k|visualizer|mv)\b/gi, '')
    .replace(/[-|–]+\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function fetchLyrics(artist: string, title: string): Promise<string | null> {
  const opts = { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) };

  // Exact match first.
  const direct = await fetch(
    `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`,
    opts,
  );
  if (direct.ok) {
    const data = (await direct.json()) as LrcEntry;
    if (data.plainLyrics?.trim()) return data.plainLyrics.trim();
  }

  // Fall back to a fuzzy search and take the first hit with lyrics.
  const search = await fetch(
    `https://lrclib.net/api/search?q=${encodeURIComponent(`${title} ${artist}`.trim())}`,
    opts,
  );
  if (search.ok) {
    const results = (await search.json()) as LrcEntry[];
    const hit = results.find((r) => r.plainLyrics?.trim());
    if (hit?.plainLyrics) return hit.plainLyrics.trim();
  }
  return null;
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
      const text = await fetchLyrics(artist, title);
      if (!text) {
        await replyError(interaction, `Couldn't find lyrics for **${current.info.title}**.`);
        return;
      }
      const body = text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🎤 ${current.info.title}`.slice(0, 256))
        .setDescription(body)
        .setFooter({ text: 'Lyrics via LRCLIB' });
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.warn({ err, track: current.info.title }, 'lyrics fetch failed');
      await replyError(interaction, 'The lyrics service is unavailable right now.');
    }
  },
};
