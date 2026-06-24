/**
 * LRCLIB (lrclib.net) lyrics — a free, keyless, community lyrics DB. Shared by
 * the /lyrics command (plain lyrics) and the now-playing card (timed/synced
 * lyrics). No Lavalink plugin (so it can't break Lavalink's boot). Fail-soft.
 */

const UA = 'Elfaria (+https://github.com/Pet-Al/Elfaria)';

interface LrcEntry {
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  trackName?: string;
  artistName?: string;
}

type FetchOpts = { headers: Record<string, string>; signal: AbortSignal };
const opts = (): FetchOpts => ({ headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });

/** Strip the noise YouTube/SoundCloud titles add so the lookup matches. */
export function clean(input: string): string {
  return input
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\bfeat\.?.*$/i, '')
    .replace(/\b(official|lyrics?|audio|video|music video|hd|4k|visualizer|mv)\b/gi, '')
    .replace(/[-|–]+\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Candidate (artist, title) pairs from messy track metadata, most specific first. */
export function candidatePairs(rawArtist: string, rawTitle: string): [string, string][] {
  const artist = clean(rawArtist.replace(/ - Topic$/i, ''));
  const title = clean(rawTitle);
  const pairs: [string, string][] = [[artist, title]];
  const dash = rawTitle.split(/\s[-–—]\s/);
  if (dash.length >= 2) pairs.push([clean(dash[0]!), clean(dash.slice(1).join(' - '))]);
  return pairs;
}

interface Attempt {
  text?: string;
  serviceError: boolean;
}

/** found → lyrics; not-found → LRCLIB lacks it; error → service unreachable. */
export type LyricsResult = { status: 'found'; text: string } | { status: 'not-found' } | { status: 'error' };

async function lookup(artist: string, title: string, o: FetchOpts): Promise<Attempt> {
  if (!artist || !title) return { serviceError: false };
  try {
    const res = await fetch(
      `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`,
      o,
    );
    if (res.status === 404) return { serviceError: false };
    if (!res.ok) return { serviceError: true };
    const data = (await res.json()) as LrcEntry;
    return { text: data.plainLyrics?.trim() || undefined, serviceError: false };
  } catch {
    return { serviceError: true };
  }
}

async function searchLyrics(query: string, o: FetchOpts): Promise<Attempt> {
  if (!query.trim()) return { serviceError: false };
  try {
    const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, o);
    if (!res.ok) return { serviceError: true };
    const results = (await res.json()) as LrcEntry[];
    return {
      text: results.find((r) => r.plainLyrics?.trim())?.plainLyrics?.trim() || undefined,
      serviceError: false,
    };
  } catch {
    return { serviceError: true };
  }
}

/** Best-effort plain lyrics for a track. Never throws; reports found/not-found/error. */
export async function fetchLyrics(rawArtist: string, rawTitle: string): Promise<LyricsResult> {
  const o = opts();
  const pairs = candidatePairs(rawArtist, rawTitle);
  const [artist, title] = pairs[0]!;

  let serviceError = false;
  const consider = (a: Attempt): string | undefined => {
    serviceError ||= a.serviceError;
    return a.text;
  };

  for (const [a, t] of pairs) {
    const text = consider(await lookup(a, t, o));
    if (text) return { status: 'found', text };
  }
  for (const query of [`${title} ${artist}`, title]) {
    const text = consider(await searchLyrics(query, o));
    if (text) return { status: 'found', text };
  }
  return serviceError ? { status: 'error' } : { status: 'not-found' };
}

// ── Timed (synced) lyrics for the now-playing card ────────────────────────────

export interface SyncedLine {
  /** offset from the start of the track, ms */ t: number;
  text: string;
}

/** Parse LRC text (`[mm:ss.xx] line`) into sorted, non-empty timed lines. */
export function parseLrc(lrc: string): SyncedLine[] {
  const out: SyncedLine[] = [];
  for (const raw of lrc.split('\n')) {
    const text = raw.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, '').trim();
    const stamps = raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g);
    for (const m of stamps) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      const frac = m[3] ? Number(`0.${m[3]}`) : 0;
      const t = Math.round((min * 60 + sec + frac) * 1000);
      if (text) out.push({ t, text });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Fetch timed lyrics for a track, or null if none/unavailable. Never throws. */
export async function fetchSyncedLyrics(
  rawArtist: string,
  rawTitle: string,
): Promise<SyncedLine[] | null> {
  const o = opts();
  for (const [artist, title] of candidatePairs(rawArtist, rawTitle)) {
    if (!artist || !title) continue;
    try {
      const res = await fetch(
        `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`,
        o,
      );
      if (!res.ok) continue;
      const data = (await res.json()) as LrcEntry;
      if (data.syncedLyrics?.trim()) {
        const lines = parseLrc(data.syncedLyrics);
        if (lines.length) return lines;
      }
    } catch {
      return null; // service issue — give up quietly
    }
  }
  return null;
}

/** The line that should be showing at `positionMs` (the last one already reached). */
export function currentLine(lines: SyncedLine[], positionMs: number): string | null {
  let line: string | null = null;
  for (const l of lines) {
    if (l.t <= positionMs) line = l.text;
    else break;
  }
  return line;
}
