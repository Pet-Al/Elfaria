import { db } from './index.js';

/**
 * Saved-playlist repository (doc §6 "saved playlists").
 *
 * A durable feature that justifies having a database at all: users can save the
 * current queue under a name and reload it later, surviving restarts.
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

interface PlaylistRow {
  id: number;
}

const findPlaylistStmt = db.prepare<[string, string, string], PlaylistRow>(
  'SELECT id FROM playlists WHERE guild_id = ? AND owner_id = ? AND name = ?',
);

const insertPlaylistStmt = db.prepare(
  'INSERT INTO playlists (guild_id, owner_id, name) VALUES (?, ?, ?)',
);

const deleteTracksStmt = db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?');

const insertTrackStmt = db.prepare(`
  INSERT INTO playlist_tracks (playlist_id, title, url, duration, position)
  VALUES (@playlistId, @title, @url, @duration, @position)
`);

const listPlaylistsStmt = db.prepare<[string, string], PlaylistSummary>(`
  SELECT p.id AS id, p.name AS name, p.owner_id AS ownerId,
         COUNT(t.id) AS trackCount
  FROM playlists p
  LEFT JOIN playlist_tracks t ON t.playlist_id = p.id
  WHERE p.guild_id = ? AND p.owner_id = ?
  GROUP BY p.id
  ORDER BY p.name COLLATE NOCASE
`);

const loadTracksStmt = db.prepare<
  [number],
  { title: string; url: string; duration: string | null }
>(
  `SELECT title, url, duration FROM playlist_tracks
   WHERE playlist_id = ? ORDER BY position ASC`,
);

const deletePlaylistStmt = db.prepare(
  'DELETE FROM playlists WHERE guild_id = ? AND owner_id = ? AND name = ?',
);

/**
 * Create or overwrite a named playlist for a user in a guild, replacing its
 * tracks. Wrapped in a transaction so a save is all-or-nothing.
 */
export const savePlaylist = db.transaction(
  (guildId: string, ownerId: string, name: string, tracks: SavedTrack[]): number => {
    const existing = findPlaylistStmt.get(guildId, ownerId, name);
    let playlistId: number;

    if (existing) {
      playlistId = existing.id;
      deleteTracksStmt.run(playlistId);
    } else {
      const result = insertPlaylistStmt.run(guildId, ownerId, name);
      playlistId = Number(result.lastInsertRowid);
    }

    tracks.forEach((track, index) => {
      insertTrackStmt.run({
        playlistId,
        title: track.title,
        url: track.url,
        duration: track.duration,
        position: index,
      });
    });

    return playlistId;
  },
);

export function listPlaylists(guildId: string, ownerId: string): PlaylistSummary[] {
  return listPlaylistsStmt.all(guildId, ownerId);
}

export function loadPlaylistTracks(
  guildId: string,
  ownerId: string,
  name: string,
): SavedTrack[] | null {
  const playlist = findPlaylistStmt.get(guildId, ownerId, name);
  if (!playlist) return null;
  return loadTracksStmt.all(playlist.id).map((row) => ({
    title: row.title,
    url: row.url,
    duration: row.duration,
  }));
}

export function deletePlaylist(guildId: string, ownerId: string, name: string): boolean {
  const result = deletePlaylistStmt.run(guildId, ownerId, name);
  return result.changes > 0;
}
