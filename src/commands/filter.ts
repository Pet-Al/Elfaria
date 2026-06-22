import { SlashCommandBuilder } from 'discord.js';
import type { Player } from 'lavalink-client';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getPlayer } from '../music/QueueManager.js';

/**
 * Audio filters / EQ (doc roadmap). Lavalink does the DSP; we just toggle
 * presets. Each invocation resets filters first, then applies the chosen one,
 * so effects don't stack unexpectedly. "off" clears everything.
 */
async function applyFilter(player: Player, type: string): Promise<void> {
  const fm = player.filterManager;
  await fm.resetFilters();
  switch (type) {
    case 'off':
      return;
    case 'bassboost':
      await fm.setEQPreset('BassboostMedium');
      return;
    case 'pop':
      await fm.setEQPreset('Pop');
      return;
    case 'rock':
      await fm.setEQPreset('Rock');
      return;
    case 'electronic':
      await fm.setEQPreset('Electronic');
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
