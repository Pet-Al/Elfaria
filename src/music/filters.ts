import type { EQBand, Player } from 'lavalink-client';

/**
 * Audio filter presets + apply logic (shared by /filter, /filter-save, and the
 * per-guild filter persistence applied on player creation).
 *
 * Anti-clipping: stock EQ presets boost bands up to +0.30/+0.40, which clips
 * into static on loud tracks. These custom curves cap every boost at +0.15 and
 * pair boosts with gentle cuts to keep headroom — same character, no distortion.
 */

/** The filter choices offered by /filter and /filter-save. */
export const FILTER_CHOICES = [
  { name: 'Off (clear)', value: 'off' },
  { name: 'Bass boost', value: 'bassboost' },
  { name: 'Nightcore', value: 'nightcore' },
  { name: 'Vaporwave', value: 'vaporwave' },
  { name: '8D', value: '8d' },
  { name: 'Karaoke', value: 'karaoke' },
  { name: 'Lowpass', value: 'lowpass' },
  { name: 'Pop', value: 'pop' },
  { name: 'Rock', value: 'rock' },
  { name: 'Electronic', value: 'electronic' },
  { name: 'Vocal (singing clarity)', value: 'vocal' },
] as const;

/** Build a 15-band EQ from an array of gains (band index = position). */
function bands(gains: number[]): EQBand[] {
  return gains.map((gain, band) => ({ band, gain }));
}

// Exported for tests (the anti-clipping invariant: no band exceeds MAX_BOOST).
export const MAX_BOOST = 0.15;
export const EQ_PRESETS: Record<string, EQBand[]> = {
  bassboost: bands([
    0.15, 0.14, 0.12, 0.08, 0.04, 0, -0.02, -0.02, -0.02, -0.02, -0.02, -0.02, -0.02, -0.02, -0.02,
  ]),
  pop: bands([
    -0.02, 0.0, 0.03, 0.06, 0.07, 0.05, 0.02, -0.02, -0.03, -0.02, 0.0, 0.02, 0.04, 0.05, 0.05,
  ]),
  rock: bands([
    0.1, 0.08, 0.05, 0.02, -0.02, -0.04, -0.02, 0.0, 0.02, 0.04, 0.05, 0.05, 0.06, 0.06, 0.06,
  ]),
  electronic: bands([
    0.12, 0.1, 0.06, 0.02, 0.0, -0.03, -0.04, -0.02, 0.0, 0.02, 0.04, 0.05, 0.06, 0.07, 0.07,
  ]),
  // Vocal clarity: gently cut the low rumble/mud and lift the presence band
  // (~630Hz–4kHz, bands 7–11) where voices sit, for clearer singing.
  vocal: bands([
    -0.05, -0.04, -0.03, -0.02, 0.0, 0.03, 0.06, 0.1, 0.12, 0.12, 0.1, 0.08, 0.04, 0.0, -0.02,
  ]),
};

/** Apply a filter preset to a player, clearing any previous one first. Records
 * the active preset name on the player ('filter') so the now-playing card can
 * show a 🎛️ modifier badge; 'off' clears it. */
export async function applyFilter(player: Player, type: string): Promise<void> {
  const fm = player.filterManager;
  await fm.resetFilters();
  await fm.clearEQ();
  player.set('filter', type === 'off' ? undefined : type);
  switch (type) {
    case 'off':
      return;
    case 'bassboost':
    case 'pop':
    case 'rock':
    case 'electronic':
      await fm.setEQ(EQ_PRESETS[type]!);
      return;
    case 'nightcore':
      await fm.toggleNightcore();
      return;
    case 'vaporwave':
      await fm.toggleVaporwave();
      return;
    case '8d':
      await fm.toggleRotation();
      return;
    case 'karaoke':
      await fm.toggleKaraoke();
      return;
    case 'lowpass':
      await fm.toggleLowPass();
      return;
  }
}
