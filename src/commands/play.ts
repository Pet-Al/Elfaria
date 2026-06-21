import { SlashCommandBuilder } from 'discord.js';
import { getVoiceContext, replyError } from '../lib/interactions.js';
import { logger } from '../lib/logger.js';
import type { Command } from '../lib/types.js';
import { formatDuration, getOrCreatePlayer } from '../music/QueueManager.js';
import { resolve } from '../music/sources.js';

/**
 * /play — the heart of the bot (doc §3–§5, milestone 4).
 *
 * Honours the 3-second rule: defer first, then create/connect the Lavalink
 * player, resolve the query through the sourcing layer, enqueue, and start
 * playback if idle. The "now playing" announcement is emitted by the trackStart
 * Lavalink event (music/player.ts); here we just acknowledge the enqueue.
 */
export const play: Command = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song or playlist (search text or a link).')
    .addStringOption((opt) =>
      opt
        .setName('query')
        .setDescription('Song name or URL (YouTube, SoundCloud, Spotify…)')
        .setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const voice = await getVoiceContext(interaction);
    if (!voice) return;

    const query = interaction.options.getString('query', true);

    try {
      const player = await getOrCreatePlayer(interaction, voice.voiceChannel.id);
      const result = await resolve(player, query, interaction.user);

      if (!result.tracks.length) {
        await replyError(interaction, `No results found for **${query}**.`);
        return;
      }

      if (result.loadType === 'playlist') {
        player.queue.add(result.tracks);
        await interaction.editReply(
          `🎶 Added **${result.tracks.length}** tracks from **${result.playlist?.title ?? 'playlist'}** to the queue.`,
        );
      } else {
        const track = result.tracks[0]!;
        const length = track.info.isStream ? 'live' : formatDuration(track.info.duration);
        player.queue.add(track);
        await interaction.editReply(`🎶 Added **${track.info.title}** \`${length}\` to the queue.`);
      }

      if (!player.playing && !player.paused) await player.play();
    } catch (err) {
      logger.error({ err, guildId: interaction.guildId, query }, 'failed to start playback');
      await replyError(
        interaction,
        'Something went wrong trying to play that. The audio service may be unavailable.',
      );
    }
  },
};
