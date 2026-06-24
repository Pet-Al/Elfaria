import type { Player } from 'lavalink-client';
import { logger } from '../lib/logger.js';

/**
 * SponsorBlock integration (doc roadmap). YouTube uploads often bury the music
 * under sponsor reads, intros/outros, and off-topic talking. SponsorBlock is a
 * crowd-sourced database of those segments; the Lavalink SponsorBlock plugin
 * skips them automatically once we register the categories on a player.
 *
 * The categories we enable by default skew toward "just play the music": the
 * sponsor/self-promo/interaction reminders plus a track's intro/outro and the
 * `music_offtopic` non-song sections. We deliberately DON'T skip `preview` or
 * `filler` (too aggressive for a song). Toggle per guild with /sponsorblock.
 */

/** A guild's persisted SponsorBlock preference. */
export const sponsorBlockKey = (guildId: string): string => `sponsorblock:${guildId}`;

/** The segment categories we skip when SponsorBlock is enabled. */
export const DEFAULT_SEGMENTS = [
  'sponsor',
  'selfpromo',
  'interaction',
  'intro',
  'outro',
  'music_offtopic',
] as const;

/**
 * Turn SponsorBlock on (register our categories) or off (clear them) for a
 * player. Fail-soft: if the Lavalink SponsorBlock plugin isn't installed the
 * REST call 404s — we log once and carry on, never breaking playback.
 */
export async function applySponsorBlock(player: Player, enabled: boolean): Promise<void> {
  try {
    if (enabled) await player.setSponsorBlock([...DEFAULT_SEGMENTS]);
    else await player.deleteSponsorBlock();
  } catch (err) {
    logger.warn(
      { err, guildId: player.guildId },
      'SponsorBlock call failed (is the Lavalink SponsorBlock plugin installed?)',
    );
  }
}
