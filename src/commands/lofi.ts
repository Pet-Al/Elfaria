import { SlashCommandBuilder } from 'discord.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import { logger } from '../lib/logger.js';
import type { Command } from '../lib/types.js';
import { getOrCreatePlayer } from '../music/QueueManager.js';
import { resolve } from '../music/sources.js';

/**
 * /lofi — start a continuous lofi radio stream from YouTube (the long-running
 * Lofi Girl live stations). It replaces the current queue with the stream and
 * turns on 24/7 mode, so it keeps going until you stop it. Because the streams
 * are live they never "end", so the bot stays — but it still leaves if the voice
 * channel empties (the empty-channel rule always wins).
 */
const STATIONS: Record<string, { id: string; label: string }> = {
  study: { id: 'jfKfPfyJRdk', label: 'lofi hip hop radio 📚 beats to relax/study to' },
  sleep: { id: 'rUxyKA_-grg', label: 'lofi hip hop radio 💤 beats to sleep/chill to' },
  synthwave: { id: '4xDzrJKXOOY', label: 'synthwave radio 🌌 beats to chill/game to' },
};

export const lofi: Command = {
  data: new SlashCommandBuilder()
    .setName('lofi')
    .setDescription('Play a continuous lofi radio stream (and enable 24/7).')
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
      const url = `https://www.youtube.com/watch?v=${station.id}`;
      const result = await resolve(player, url, interaction.user);
      const track = result.tracks[0];
      if (!track) {
        await replyError(interaction, "Couldn't load the lofi stream right now — try again.");
        return;
      }

      // Replace whatever's queued with the stream and start it immediately.
      if (player.queue.tracks.length > 0) await player.queue.splice(0, player.queue.tracks.length);
      await player.play({ clientTrack: track });
      player.set('247', true); // a live stream never ends; keep us connected

      await replyOk(interaction, `🎧 **Lofi mode** — now playing **${station.label}**. (24/7 on.)`);
    } catch (err) {
      logger.error({ err, guildId: interaction.guildId }, 'lofi start failed');
      await replyError(interaction, 'Something went wrong starting lofi mode.');
    }
  },
};
