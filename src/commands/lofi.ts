import { SlashCommandBuilder } from 'discord.js';
import type { Track } from 'lavalink-client';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import { logger } from '../lib/logger.js';
import type { Command } from '../lib/types.js';
import { getOrCreatePlayer } from '../music/QueueManager.js';
import { resolve } from '../music/sources.js';

/**
 * /lofi — load a curated lofi PLAYLIST and play it continuously. We use a
 * playlist (not the 24/7 live streams, which the YouTube clients struggle to
 * resolve) so it's reliable, then loop the queue so it never runs out. Shuffled
 * by default. Replaces whatever's currently queued.
 */
const LOFI_PLAYLIST = 'https://www.youtube.com/playlist?list=PL6NdkXsPL07Il2hEQGcLI4dg_LTg7xA2L';

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

export const lofi: Command = {
  data: new SlashCommandBuilder()
    .setName('lofi')
    .setDescription('Play a continuous lofi playlist (looped).')
    .addBooleanOption((opt) =>
      opt.setName('shuffle').setDescription('Shuffle the playlist (default: true).'),
    ),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!(await isDj(interaction))) {
      await replyError(interaction, 'You need the DJ role to start lofi mode.');
      return;
    }

    await interaction.deferReply();
    try {
      const player = await getOrCreatePlayer(interaction, voice.voiceChannel.id);
      const result = await resolve(player, LOFI_PLAYLIST, interaction.user);
      let tracks = result.tracks as Track[];
      if (tracks.length === 0) {
        await replyError(interaction, "Couldn't load the lofi playlist right now — try again.");
        return;
      }
      if (interaction.options.getBoolean('shuffle') !== false) tracks = shuffle([...tracks]);

      // Replace the current queue with the playlist and loop it for endless lofi.
      if (player.queue.tracks.length > 0) await player.queue.splice(0, player.queue.tracks.length);
      await player.queue.add(tracks);
      await player.setRepeatMode('queue');
      if (!player.playing && !player.paused) await player.play();

      await replyOk(
        interaction,
        `🎧 **Lofi mode** — queued **${tracks.length}** tracks on loop${interaction.options.getBoolean('shuffle') !== false ? ' (shuffled)' : ''}.`,
      );
    } catch (err) {
      logger.error({ err, guildId: interaction.guildId }, 'lofi start failed');
      await replyError(interaction, 'Something went wrong starting lofi mode.');
    }
  },
};
