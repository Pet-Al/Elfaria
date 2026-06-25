import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SearchResult } from 'lavalink-client';
import { config } from '../config.js';
import { getVoiceContext, replyError } from '../lib/interactions.js';
import { logger } from '../lib/logger.js';
import type { Command } from '../lib/types.js';
import { getOrCreatePlayer, leaveIfIdle } from '../music/QueueManager.js';
import { refreshPanel } from '../music/player.js';

/**
 * /tts — speak text into the voice channel using the DuncteBot plugin's
 * credential-free `speak:` source (no Google Cloud key needed). Gated by the
 * TTS_ENABLED flag and, in practice, by the DuncteBot plugin being loaded in
 * lavalink/application.yml — if the source can't resolve we say so rather than
 * failing silently.
 *
 * It plays NEXT (front of the queue) so an announcement doesn't wait behind the
 * whole queue; if nothing is playing it starts immediately. We search the
 * `speak:` source directly (not the cached resolve() path) so each unique phrase
 * never pollutes the song search cache.
 */
const MAX_LEN = 200;

export const tts: Command = {
  data: new SlashCommandBuilder()
    .setName('tts')
    .setDescription('Speak a short message into the voice channel (text-to-speech).')
    .addStringOption((opt) =>
      opt
        .setName('text')
        .setDescription('What to say (up to 200 characters).')
        .setRequired(true)
        .setMaxLength(MAX_LEN),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!config.plugins.tts) {
      await replyError(interaction, 'Text-to-speech is disabled on this bot.');
      return;
    }

    const voice = await getVoiceContext(interaction);
    if (!voice) return;

    const text = interaction.options.getString('text', true).trim();
    if (!text) {
      await replyError(interaction, 'Give me something to say.');
      return;
    }

    try {
      const player = await getOrCreatePlayer(interaction, voice.voiceChannel.id);
      const wasActive = player.playing || player.paused;

      // The DuncteBot `speak:` source turns the text into a playable track.
      const result = (await player.search(
        { query: `speak:${text}` },
        interaction.user,
      )) as SearchResult;
      const track = result.tracks[0];
      if (!track) {
        await leaveIfIdle(player);
        await replyError(
          interaction,
          "Couldn't generate speech — the TTS source isn't available (is the DuncteBot plugin loaded?).",
        );
        return;
      }

      // Label it so the now-playing card reads as speech, not a mystery track.
      track.info.title = `🗣️ "${text.length > 60 ? `${text.slice(0, 57)}…` : text}"`;

      if (!wasActive) {
        player.queue.add(track);
        await player.play();
        await interaction.editReply('🗣️ Speaking now.');
      } else {
        // Play next: insert at the front of the up-next list.
        await player.queue.add(track, 0);
        void refreshPanel(player);
        await interaction.editReply('🗣️ Queued to speak right after the current track.');
      }
    } catch (err) {
      logger.error({ err, guildId: interaction.guildId }, 'tts failed');
      await replyError(interaction, 'Something went wrong generating that speech.');
    }
  },
};
