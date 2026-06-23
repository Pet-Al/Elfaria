import { SlashCommandBuilder } from 'discord.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { formatDuration, getPlayer, parseTimestamp } from '../music/QueueManager.js';
import { refreshPanel } from '../music/player.js';

/** /seek — jump to a position in the current track. DJ-gated. */
export const seek: Command = {
  data: new SlashCommandBuilder()
    .setName('seek')
    .setDescription('Jump to a position in the current track.')
    .addStringOption((opt) =>
      opt
        .setName('to')
        .setDescription('Position, e.g. 90, 1:30, or 1:02:03.')
        .setRequired(true),
    ),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!(await isDj(interaction))) {
      await replyError(interaction, 'You need the DJ role to seek.');
      return;
    }

    const player = getPlayer(interaction);
    const current = player?.queue.current;
    if (!player || !current) {
      await replyError(interaction, 'Nothing is playing.');
      return;
    }
    if (current.info.isStream) {
      await replyError(interaction, "You can't seek within a live stream.");
      return;
    }

    const ms = parseTimestamp(interaction.options.getString('to', true));
    if (ms === null) {
      await replyError(interaction, 'Use a position like `90`, `1:30`, or `1:02:03`.');
      return;
    }
    if (ms > current.info.duration) {
      await replyError(
        interaction,
        `That's past the end of the track (${formatDuration(current.info.duration)}).`,
      );
      return;
    }

    await player.seek(ms);
    await replyOk(interaction, `⏩ Seeked to **${formatDuration(ms)}**.`);
    void refreshPanel(player, true);
  },
};
