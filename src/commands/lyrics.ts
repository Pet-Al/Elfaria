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

/** One lookup's outcome: maybe lyrics, and whether the SERVICE (not the song) failed. */
interface Attempt {
  text?: string;
  serviceError: boolean;
}

/**
 * The aggregate result, so the caller can tell the user the RIGHT thing:
 *  - found      → here are the lyrics
 *  - not-found  → LRCLIB simply doesn't have this track (a 404/empty result)
 *  - error      → LRCLIB itself was unreachable / 5xx / timed out
 */
type LyricsResult = { status: 'found'; text: string } | { status: 'not-found' } | { status: 'error' };

/** Exact artist+track lookup. A 404 is a genuine miss; 5xx/network is a service error. */
async function lookup(artist: string, title: string, opts: FetchOpts): Promise<Attempt> {
  if (!artist || !title) return { serviceError: false };
  try {
    const res = await fetch(
      `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`,
      opts,
    );
    if (res.status === 404) return { serviceError: false }; // not found for this pair
    if (!res.ok) return { serviceError: true };
    const data = (await res.json()) as LrcEntry;
    return { text: data.plainLyrics?.trim() || undefined, serviceError: false };
  } catch {
    return { serviceError: true }; // network / timeout / abort
  }
}

/** Fuzzy search; take the first result that actually has lyrics. */
async function searchLyrics(query: string, opts: FetchOpts): Promise<Attempt> {
  if (!query.trim()) return { serviceError: false };
  try {
    const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, opts);
    if (!res.ok) return { serviceError: true };
    const results = (await res.json()) as LrcEntry[];
    return { text: results.find((r) => r.plainLyrics?.trim())?.plainLyrics?.trim() || undefined, serviceError: false };
  } catch {
    return { serviceError: true };
  }
}

/**
 * Best-effort lyrics for a track. Tries several (artist, title) shapes because
 * YouTube/SoundCloud titles are messy: the channel name is often not the artist
 * ("RickAstleyVEVO"), and the real artist frequently lives in the title itself
 * as "Artist - Song". Tracks whether any failure was the SERVICE vs a genuine
 * miss, so the caller can give an accurate message. Never throws.
 */
async function fetchLyrics(rawArtist: string, rawTitle: string): Promise<LyricsResult> {
  const opts: FetchOpts = { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) };
  const artist = clean(rawArtist.replace(/ - Topic$/i, ''));
  const title = clean(rawTitle);

  // Candidate (artist, title) pairs, most specific first.
  const pairs: [string, string][] = [[artist, title]];
  // "Artist - Song" titles: split on the first dash and try that pairing too.
  const dash = rawTitle.split(/\s[-–—]\s/);
  if (dash.length >= 2) pairs.push([clean(dash[0]!), clean(dash.slice(1).join(' - '))]);

  let serviceError = false;
  const consider = (a: Attempt): string | undefined => {
    serviceError ||= a.serviceError;
    return a.text;
  };

  for (const [a, t] of pairs) {
    const text = consider(await lookup(a, t, opts));
    if (text) return { status: 'found', text };
  }
  for (const query of [`${title} ${artist}`, title]) {
    const text = consider(await searchLyrics(query, opts));
    if (text) return { status: 'found', text };
  }

  return serviceError ? { status: 'error' } : { status: 'not-found' };
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

    let result: LyricsResult;
    try {
      result = await fetchLyrics(current.info.author ?? '', current.info.title ?? '');
    } catch (err) {
      // fetchLyrics is meant to never throw; treat an unexpected error as a
      // service problem rather than letting the command fall over.
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
