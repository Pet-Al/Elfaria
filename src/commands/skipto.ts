import { SlashCommandBuilder } from 'discord.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getPlayer } from '../music/QueueManager.js';

/** /skipto — jump straight to a given position in the queue. DJ-gated. */
export const skipto: Command = {
  data: new SlashCommandBuilder()
    .setName('skipto')
    .setDescription('Skip straight to a position in the queue.')
    .addIntegerOption((opt) =>
      opt
        .setName('position')
        .setDescription('Queue position to jump to (see /queue).')
        .setRequired(true)
        .setMinValue(1),
    ),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!(await isDj(interaction))) {
      await replyError(interaction, 'You need the DJ role to do that.');
      return;
    }

    const player = getPlayer(interaction);
    if (!player) {
      await replyError(interaction, 'Nothing is playing.');
      return;
    }

    const position = interaction.options.getInteger('position', true);
    if (position > player.queue.tracks.length) {
      await replyError(
        interaction,
        `The queue only has **${player.queue.tracks.length}** upcoming track(s).`,
      );
      return;
    }

    const target = player.queue.tracks[position - 1];
    await player.skip(position); // skipTo = 1-based index of the next track to play
    await replyOk(interaction, `⏭️ Skipped to **${target?.info?.title ?? `#${position}`}**.`);
  },
};
