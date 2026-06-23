import { SlashCommandBuilder } from 'discord.js';
import { getLastPlayed } from '../db/history.js';
import { getVoiceContext, replyError } from '../lib/interactions.js';
import { logger } from '../lib/logger.js';
import type { Command } from '../lib/types.js';
import { getOrCreatePlayer } from '../music/QueueManager.js';
import { resolve } from '../music/sources.js';

/**
 * /replay — re-queue the most recently played track (doc roadmap, "replay").
 * Re-resolves it by URL (robust against stale encoded tracks) and starts it,
 * which also covers "the song ended and I want to hear it again".
 */
export const replay: Command = {
  data: new SlashCommandBuilder()
    .setName('replay')
    .setDescription('Play the most recently played track again.'),
  async execute(interaction) {
    await interaction.deferReply();

    const voice = await getVoiceContext(interaction);
    if (!voice) return;

    const last = await getLastPlayed(interaction.guildId!);
    if (!last) {
      await replyError(interaction, 'Nothing has played recently to replay.');
      return;
    }

    try {
      const player = await getOrCreatePlayer(interaction, voice.voiceChannel.id);
      const result = await resolve(player, last.uri, interaction.user);
      if (!result.tracks.length) {
        await replyError(interaction, `Couldn't reload **${last.title}**.`);
        return;
      }

      const track = result.tracks[0]!;
      player.queue.add(track);
      if (!player.playing && !player.paused) await player.play();
      await interaction.editReply(`↩️ Replaying **${track.info.title}**.`);
    } catch (err) {
      logger.error({ err, guildId: interaction.guildId }, 'replay failed');
      await replyError(interaction, 'Something went wrong replaying that.');
    }
  },
};
