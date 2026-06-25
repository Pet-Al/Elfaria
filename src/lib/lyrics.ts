/**
 * LRCLIB (lrclib.net) lyrics — a free, keyless, community lyrics DB. Shared by
 * the /lyrics command (plain lyrics) and the now-playing card (timed/synced
 * lyrics). No Lavalink plugin (so it can't break Lavalink's boot).
 *
 * LRCLIB can be slow/flaky, so each request has a generous timeout and ONE retry
 * — a single transient timeout used to surface as "lyrics unavailable", which was
 * the recurring "lyrics don't work". A clean 404 is still treated as not-found.
 */

const UA = 'Elfaria (+https://github.com/Pet-Al/Elfaria)';
const TIMEOUT_MS = 12_000;

interface LrcEntry {
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  trackName?: string;
  artistName?: string;
}

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

interface HttpResult {
  res?: Response;
  serviceError: boolean;
}

/** GET with a generous timeout and one retry on timeout/5xx (never throws). */
async function httpGet(url: string): Promise<HttpResult> {
  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status >= 500) {
        if (attempt === 0) continue; // transient — retry once
        return { serviceError: true };
      }
      return { res, serviceError: false };
    } catch {
      if (attempt === 0) continue; // network/timeout — retry once
      return { serviceError: true };
    }
  }
  return { serviceError: true };
}

interface Attempt {
  text?: string;
  serviceError: boolean;
}

/** found → lyrics; not-found → LRCLIB lacks it; error → service unreachable. */
export type LyricsResult = { status: 'found'; text: string } | { status: 'not-found' } | { status: 'error' };

const getUrl = (artist: string, title: string) =>
  `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;

async function lookup(artist: string, title: string): Promise<Attempt> {
  if (!artist || !title) return { serviceError: false };
  const { res, serviceError } = await httpGet(getUrl(artist, title));
  if (serviceError || !res) return { serviceError: true };
  if (res.status === 404) return { serviceError: false }; // genuine miss
  if (!res.ok) return { serviceError: true };
  const data = (await res.json().catch(() => ({}))) as LrcEntry;
  return { text: data.plainLyrics?.trim() || undefined, serviceError: false };
}

async function searchLyrics(query: string): Promise<Attempt> {
  if (!query.trim()) return { serviceError: false };
  const { res, serviceError } = await httpGet(
    `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`,
  );
  if (serviceError || !res || !res.ok) return { serviceError: serviceError || !res?.ok };
  const results = (await res.json().catch(() => [])) as LrcEntry[];
  return {
    text: results.find((r) => r.plainLyrics?.trim())?.plainLyrics?.trim() || undefined,
    serviceError: false,
  };
}

/** Best-effort plain lyrics for a track. Never throws; reports found/not-found/error. */
export async function fetchLyrics(rawArtist: string, rawTitle: string): Promise<LyricsResult> {
  const pairs = candidatePairs(rawArtist, rawTitle);
  const [artist, title] = pairs[0]!;

  let serviceError = false;
  const consider = (a: Attempt): string | undefined => {
    serviceError ||= a.serviceError;
    return a.text;
  };

  for (const [a, t] of pairs) {
    const text = consider(await lookup(a, t));
    if (text) return { status: 'found', text };
  }
  for (const query of [`${title} ${artist}`, title]) {
    const text = consider(await searchLyrics(query));
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
      const frac = m[3] ? Number(`0.${m[3]}`) : 0;
      const t = Math.round((Number(m[1]) * 60 + Number(m[2]) + frac) * 1000);
      if (text) out.push({ t, text });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * Fetch timed lyrics for a track, or null if none/unavailable. Never throws.
 *
 * Mirrors fetchLyrics' resolution so the card lines up with /lyrics: it tries the
 * exact get-by-(artist,title) for each candidate pair, then — crucially — falls
 * back to LRCLIB /search (picking the first hit that actually has *synced*
 * lyrics). Messy YouTube titles/authors ("… (Official Video)", "Artist - Topic")
 * routinely miss the exact get even for mainstream songs that DO have synced
 * lyrics, which is why the live card line used to stay blank while /lyrics worked.
 */
export async function fetchSyncedLyrics(
  rawArtist: string,
  rawTitle: string,
): Promise<SyncedLine[] | null> {
  const pairs = candidatePairs(rawArtist, rawTitle);

  // 1) Exact get by (artist, title), most specific first.
  for (const [artist, title] of pairs) {
    if (!artist || !title) continue;
    const { res, serviceError } = await httpGet(getUrl(artist, title));
    if (serviceError) break; // LRCLIB unreachable — don't hammer; try search once below
    if (!res?.ok) continue; // 404 / miss — try the next pair
    const data = (await res.json().catch(() => ({}))) as LrcEntry;
    if (data.syncedLyrics?.trim()) {
      const lines = parseLrc(data.syncedLyrics);
      if (lines.length) return lines;
    }
  }

  // 2) Search fallback — finds synced lyrics the exact get missed (the common
  //    case for mainstream songs with messy uploader titles).
  const [artist, title] = pairs[0]!;
  for (const query of [`${title} ${artist}`.trim(), title]) {
    if (!query) continue;
    const { res } = await httpGet(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`);
    if (!res?.ok) continue;
    const results = (await res.json().catch(() => [])) as LrcEntry[];
    const hit = results.find((r) => r.syncedLyrics?.trim());
    if (hit?.syncedLyrics) {
      const lines = parseLrc(hit.syncedLyrics);
      if (lines.length) return lines;
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
