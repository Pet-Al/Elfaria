import { SlashCommandBuilder } from 'discord.js';
import { getHistoryPage } from '../db/history.js';
import { getVoiceContext, replyError, replyOk } from '../lib/interactions.js';
import { logger } from '../lib/logger.js';
import type { Command } from '../lib/types.js';
import { getOrCreatePlayer } from '../music/QueueManager.js';
import { resolve } from '../music/sources.js';

/**
 * /replay [position] — re-queue a previously played track. With no argument it
 * replays the MOST RECENT track (position 1). Pass a position to replay a track
 * further back in this server's history (matches the numbers shown by /history).
 * Re-resolves by URL so stale encoded tracks aren't an issue.
 */
export const replay: Command = {
  data: new SlashCommandBuilder()
    .setName('replay')
    .setDescription('Replay a track from history (default: the most recent).')
    .addIntegerOption((opt) =>
      opt
        .setName('position')
        .setDescription('Which history entry to replay (1 = most recent).')
        .setMinValue(1),
    ),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;

    const position = interaction.options.getInteger('position') ?? 1;
    const entries = await getHistoryPage(interaction.guildId!, 0, position);
    const entry = entries[position - 1];
    if (!entry) {
      await replyError(
        interaction,
        entries.length === 0
          ? 'Nothing has played recently to replay.'
          : `History only has ${entries.length} track${entries.length === 1 ? '' : 's'}.`,
      );
      return;
    }

    await interaction.deferReply();
    try {
      const player = await getOrCreatePlayer(interaction, voice.voiceChannel.id);
      const result = await resolve(player, entry.uri, interaction.user);
      const track = result.tracks[0];
      if (!track) {
        await replyError(interaction, `Couldn't reload **${entry.title}**.`);
        return;
      }
      player.queue.add(track);
      if (!player.playing && !player.paused) await player.play();
      await replyOk(interaction, `↩️ Replaying **${track.info.title}**.`);
    } catch (err) {
      logger.error({ err, guildId: interaction.guildId }, 'replay failed');
      await replyError(interaction, 'Something went wrong replaying that.');
    }
  },
};
