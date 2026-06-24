import { SlashCommandBuilder } from 'discord.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import { logger } from '../lib/logger.js';
import type { Command } from '../lib/types.js';
import { getOrCreatePlayer } from '../music/QueueManager.js';
import { resolve } from '../music/sources.js';

/**
 * /lofi — start a continuous lofi radio stream from YouTube. It replaces the
 * current queue with the stream. It does NOT force 24/7: the streams are live so
 * they don't "end" on their own; but if a stream DOES drop, normal leave-on-end
 * applies (use /24-7 if you explicitly want it to hang around). If a station's
 * direct stream can't be resolved, we fall back to a YouTube search so it still
 * starts something.
 */
const STATIONS: Record<string, { id: string; search: string; label: string }> = {
  study: {
    id: 'jfKfPfyJRdk',
    search: 'lofi hip hop radio beats to relax study to',
    label: 'lofi hip hop radio 📚 beats to relax/study to',
  },
  sleep: {
    id: 'rUxyKA_-grg',
    search: 'lofi hip hop radio beats to sleep chill to',
    label: 'lofi hip hop radio 💤 beats to sleep/chill to',
  },
  synthwave: {
    id: '4xDzrJKXOOY',
    search: 'synthwave radio beats to chill game to',
    label: 'synthwave radio 🌌 beats to chill/game to',
  },
};

export const lofi: Command = {
  data: new SlashCommandBuilder()
    .setName('lofi')
    .setDescription('Play a continuous lofi radio stream.')
    .addStringOption((opt) =>
      opt
        .setName('station')
        .setDescription('Which station (default: study).')
        .addChoices(
          { name: 'Study / relax (default)', value: 'study' },
          { name: 'Sleep / chill', value: 'sleep' },
          { name: 'Synthwave', value: 'synthwave' },
        ),
    ),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!(await isDj(interaction))) {
      await replyError(interaction, 'You need the DJ role to start lofi mode.');
      return;
    }

    const station = STATIONS[interaction.options.getString('station') ?? 'study'] ?? STATIONS.study!;
    await interaction.deferReply();

    try {
      const player = await getOrCreatePlayer(interaction, voice.voiceChannel.id);
      // Try the direct live stream; if it won't resolve, fall back to a search.
      let result = await resolve(player, `https://www.youtube.com/watch?v=${station.id}`, interaction.user);
      if (!result.tracks.length) {
        result = await resolve(player, `ytsearch:${station.search}`, interaction.user);
      }
      const track = result.tracks[0];
      if (!track) {
        await replyError(interaction, "Couldn't load a lofi stream right now — try again.");
        return;
      }

      if (player.queue.tracks.length > 0) await player.queue.splice(0, player.queue.tracks.length);
      await player.play({ clientTrack: track });
      await replyOk(interaction, `🎧 **Lofi mode** — now playing **${track.info.title || station.label}**.`);
    } catch (err) {
      logger.error({ err, guildId: interaction.guildId }, 'lofi start failed');
      await replyError(interaction, 'Something went wrong starting lofi mode.');
    }
  },
};
