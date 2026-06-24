import { SlashCommandBuilder } from 'discord.js';
import type { EQBand, Player } from 'lavalink-client';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getPlayer } from '../music/QueueManager.js';

/**
 * Audio filters / EQ (doc roadmap). Lavalink does the DSP; we just toggle
 * presets. Each invocation resets filters first, then applies the chosen one,
 * so effects don't stack unexpectedly. "off" clears everything.
 *
 * Anti-clipping: the previous presets used lavalink-client's stock EQ, which
 * boosts bands up to +0.30 (Rock) / +0.40 (Electronic). On loud tracks — and
 * especially with the panel volume pushed above 100% — those boosts drive the
 * signal past full scale and HARD CLIP, which is heard as static/distortion.
 * These custom curves keep every boost ≤ +0.15 and pair boosts with gentle cuts
 * so the summed output keeps headroom: same tonal character, no static.
 */

/** Build a 15-band EQ from an array of gains (band index = position). */
function bands(gains: number[]): EQBand[] {
  return gains.map((gain, band) => ({ band, gain }));
}

// 15 Lavalink bands (~25Hz … 16kHz), gains in [-0.25, +1.0]; we stay small.
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
};

async function applyFilter(player: Player, type: string): Promise<void> {
  const fm = player.filterManager;
  // resetFilters() clears the toggle effects (nightcore, rotation, …) but NOT
  // the equalizer bands, so an EQ preset would otherwise linger after "off".
  // Clear the EQ explicitly too.
  await fm.resetFilters();
  await fm.clearEQ();
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

export const filter: Command = {
  data: new SlashCommandBuilder()
    .setName('filter')
    .setDescription('Apply an audio filter / equalizer preset.')
    .addStringOption((opt) =>
      opt
        .setName('type')
        .setDescription('The effect to apply (replaces any current filter).')
        .setRequired(true)
        .addChoices(
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
        ),
    ),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!(await isDj(interaction))) {
      await replyError(interaction, 'You need the DJ role to change filters.');
      return;
    }

    const player = getPlayer(interaction);
    if (!player?.queue.current) {
      await replyError(interaction, 'Nothing is playing.');
      return;
    }

    const type = interaction.options.getString('type', true);
    await applyFilter(player, type);
    await replyOk(
      interaction,
      type === 'off' ? '🎛️ Filters cleared.' : `🎛️ Applied **${type}** filter.`,
    );
  },
};
