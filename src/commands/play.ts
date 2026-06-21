import { useMainPlayer } from 'discord-player';
import { type GuildTextBasedChannel, SlashCommandBuilder } from 'discord.js';
import { logger } from '../lib/logger.js';
import { getVoiceContext, replyError } from '../lib/interactions.js';
import type { Command, QueueMetadata } from '../lib/types.js';
import { buildNodeOptions } from '../music/QueueManager.js';
import { resolve } from '../music/sources.js';

/**
 * /play — the heart of the bot (doc §3–§5, milestone 4).
 *
 * Flow honours the 3-second rule: defer first (resolving a track can take
 * longer than the ack window), then resolve via the sourcing layer, then play.
 * The "now playing" announcement is emitted by the playerStart event in
 * music/player.ts; here we just acknowledge the enqueue.
 */
export const play: Command = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song or playlist (search text or a link).')
    .addStringOption((opt) =>
      opt
        .setName('query')
        .setDescription('Song name or URL (YouTube, SoundCloud, Spotify…)')
        .setRequired(true)
        .setAutocomplete(true),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const voice = await getVoiceContext(interaction);
    if (!voice) return;

    const query = interaction.options.getString('query', true);
    const player = useMainPlayer();

    const resolved = await resolve(player, query, interaction.user);
    if (!resolved) {
      await replyError(interaction, `No results found for **${query}**.`);
      return;
    }

    const metadata: QueueMetadata = {
      channel: interaction.channel as GuildTextBasedChannel,
      requestedBy: interaction.user,
    };

    try {
      const { track } = await player.play(voice.voiceChannel, resolved.source, {
        nodeOptions: buildNodeOptions(interaction.guildId!, metadata),
        requestedBy: interaction.user,
      });

      if (resolved.playlistName) {
        await interaction.editReply(
          `🎶 Added **${resolved.tracks.length}** tracks from **${resolved.playlistName}** to the queue.`,
        );
      } else {
        await interaction.editReply(`🎶 Added **${track.title}** to the queue.`);
      }
    } catch (err) {
      logger.error({ err, guildId: interaction.guildId, query }, 'failed to start playback');
      await replyError(
        interaction,
        'Something went wrong trying to play that. The source may be unavailable.',
      );
    }
  },

  /**
   * Autocomplete (doc §2). Suggests tracks as the user types. Cached searches
   * (doc §7) keep this cheap; we keep results small and fail soft so a flaky
   * source never breaks the typing experience.
   */
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    if (!focused || focused.length < 3) {
      await interaction.respond([]);
      return;
    }

    try {
      const player = useMainPlayer();
      const result = await player.search(focused, { requestedBy: interaction.user });
      const choices = result.tracks.slice(0, 5).map((track) => ({
        name: `${track.title} — ${track.author}`.slice(0, 100),
        value: track.url.slice(0, 100),
      }));
      await interaction.respond(choices);
    } catch {
      await interaction.respond([]);
    }
  },
};
