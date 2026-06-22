import { db } from './driver.js';

/**
 * Saved-playlist repository (doc §6).
 *
 * The durable feature that justifies a database: users save the current queue
 * under a name and reload it later, surviving restarts. Dialect-agnostic SQL
 * (`?` placeholders) runs on either SQLite or Postgres via the driver.
 */

export interface PlaylistSummary {
  id: number;
  name: string;
  ownerId: string;
  trackCount: number;
}

export interface SavedTrack {
  title: string;
  url: string;
  duration: string | null;
}

/**
 * Create or overwrite a named playlist for a user in a guild, replacing its
 * tracks. Runs in a transaction so a save is all-or-nothing.
 */
export async function savePlaylist(
  guildId: string,
  ownerId: string,
  name: string,
  tracks: SavedTrack[],
): Promise<number> {
  return db.tx(async (q) => {
    const existing = await q.get<{ id: number }>(
      'SELECT id FROM playlists WHERE guild_id = ? AND owner_id = ? AND name = ?',
      [guildId, ownerId, name],
    );

    let playlistId: number;
    if (existing) {
      playlistId = existing.id;
      await q.run('DELETE FROM playlist_tracks WHERE playlist_id = ?', [playlistId]);
    } else {
      playlistId = await q.insert(
        'INSERT INTO playlists (guild_id, owner_id, name) VALUES (?, ?, ?)',
        [guildId, ownerId, name],
      );
    }

    for (let position = 0; position < tracks.length; position += 1) {
      const track = tracks[position]!;
      await q.run(
        `INSERT INTO playlist_tracks (playlist_id, title, url, duration, position)
         VALUES (?, ?, ?, ?, ?)`,
        [playlistId, track.title, track.url, track.duration, position],
      );
    }

    return playlistId;
  });
}

export async function listPlaylists(guildId: string, ownerId: string): Promise<PlaylistSummary[]> {
  const rows = await db.all<{
    id: number;
    name: string;
    owner_id: string;
    track_count: number;
  }>(
    `SELECT p.id, p.name, p.owner_id, COUNT(t.id) AS track_count
     FROM playlists p
     LEFT JOIN playlist_tracks t ON t.playlist_id = p.id
     WHERE p.guild_id = ? AND p.owner_id = ?
     GROUP BY p.id, p.name, p.owner_id
     ORDER BY LOWER(p.name)`,
    [guildId, ownerId],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    ownerId: row.owner_id,
    trackCount: Number(row.track_count),
  }));
}

export async function loadPlaylistTracks(
  guildId: string,
  ownerId: string,
  name: string,
): Promise<SavedTrack[] | null> {
  const playlist = await db.get<{ id: number }>(
    'SELECT id FROM playlists WHERE guild_id = ? AND owner_id = ? AND name = ?',
    [guildId, ownerId, name],
  );
  if (!playlist) return null;

  const rows = await db.all<{ title: string; url: string; duration: string | null }>(
    'SELECT title, url, duration FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC',
    [playlist.id],
  );
  return rows.map((row) => ({ title: row.title, url: row.url, duration: row.duration }));
}

export async function deletePlaylist(
  guildId: string,
  ownerId: string,
  name: string,
): Promise<boolean> {
  const existing = await db.get<{ id: number }>(
    'SELECT id FROM playlists WHERE guild_id = ? AND owner_id = ? AND name = ?',
    [guildId, ownerId, name],
  );
  if (!existing) return false;

  await db.run('DELETE FROM playlists WHERE id = ?', [existing.id]);
  return true;
}
