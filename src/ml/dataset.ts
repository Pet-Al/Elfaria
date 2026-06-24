import { db } from '../db/driver.js';

/**
 * Turn the raw play events into training "sessions" for item2vec.
 *
 * A session is a run of tracks played close together in one guild — the
 * listening equivalent of a sentence. We split a guild's play stream whenever
 * the gap between consecutive plays exceeds `sessionGapMs` (default 30 min), so
 * an afternoon's listening becomes one session and tomorrow's another. The track
 * metadata (title/author) is collected alongside so the trained model can return
 * human-readable, resolvable recommendations.
 */

export interface TrackMeta {
  title: string;
  author: string | null;
}

export interface Dataset {
  /** Ordered URI sequences, one per listening session. */
  sessions: string[][];
  /** uri → latest known {title, author}. */
  meta: Map<string, TrackMeta>;
}

interface PlayRow {
  guild_id: string | null;
  uri: string;
  title: string | null;
  author: string | null;
  created_at: number;
}

const DEFAULT_GAP_MS = 30 * 60 * 1000;

export async function buildSessions(sessionGapMs = DEFAULT_GAP_MS): Promise<Dataset> {
  const rows = await db.all<PlayRow>(
    `SELECT guild_id, uri, title, author, created_at
       FROM events
      WHERE event_type = 'play' AND uri IS NOT NULL AND uri <> ''
      ORDER BY guild_id, created_at, id`,
  );

  const meta = new Map<string, TrackMeta>();
  const sessions: string[][] = [];
  let current: string[] = [];
  let lastGuild: string | null | undefined;
  let lastTime = 0;
  // created_at is stored in seconds (unixepoch); compare in the same unit.
  const gapSec = Math.round(sessionGapMs / 1000);

  for (const row of rows) {
    meta.set(row.uri, { title: row.title ?? row.uri, author: row.author });

    const newGuild = row.guild_id !== lastGuild;
    const gapTooBig = row.created_at - lastTime > gapSec;
    if (newGuild || gapTooBig) {
      if (current.length >= 2) sessions.push(current);
      current = [];
    }
    // Skip immediate repeats (loops shouldn't dominate the co-occurrence signal).
    if (current[current.length - 1] !== row.uri) current.push(row.uri);

    lastGuild = row.guild_id;
    lastTime = row.created_at;
  }
  if (current.length >= 2) sessions.push(current);

  return { sessions, meta };
}
