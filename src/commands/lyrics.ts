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

type FetchOpts = { headers: Record<string, string>; signal: AbortSignal };

/** Exact artist+track lookup. Returns the plain lyrics or null. */
async function lookup(artist: string, title: string, opts: FetchOpts): Promise<string | null> {
  if (!artist || !title) return null;
  const res = await fetch(
    `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`,
    opts,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as LrcEntry;
  return data.plainLyrics?.trim() || null;
}

/** Fuzzy search; take the first result that actually has lyrics. */
async function searchLyrics(query: string, opts: FetchOpts): Promise<string | null> {
  if (!query.trim()) return null;
  const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, opts);
  if (!res.ok) return null;
  const results = (await res.json()) as LrcEntry[];
  return results.find((r) => r.plainLyrics?.trim())?.plainLyrics?.trim() || null;
}

/**
 * Best-effort lyrics for a track. Tries several (artist, title) shapes because
 * YouTube/SoundCloud titles are messy: the channel name is often not the artist
 * ("RickAstleyVEVO"), and the real artist frequently lives in the title itself
 * as "Artist - Song". We try the exact lookup for each shape, then fall back to
 * a couple of fuzzy searches.
 */
async function fetchLyrics(rawArtist: string, rawTitle: string): Promise<string | null> {
  const opts: FetchOpts = { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) };
  const artist = clean(rawArtist);
  const title = clean(rawTitle);

  // Candidate (artist, title) pairs, most specific first.
  const pairs: [string, string][] = [[artist, title]];
  // "Artist - Song" titles: split on the first dash and try that pairing too.
  const dash = rawTitle.split(/\s[-–—]\s/);
  if (dash.length >= 2) pairs.push([clean(dash[0]!), clean(dash.slice(1).join(' - '))]);

  for (const [a, t] of pairs) {
    const hit = await lookup(a, t, opts);
    if (hit) return hit;
  }

  // Fuzzy fallbacks: "title artist", then the cleaned title alone.
  return (await searchLyrics(`${title} ${artist}`, opts)) ?? (await searchLyrics(title, opts));
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
