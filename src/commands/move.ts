import { SlashCommandBuilder } from 'discord.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getPlayer } from '../music/QueueManager.js';
import { refreshPanel } from '../music/player.js';

/** /move — reorder a track within the upcoming queue. DJ-gated. */
export const move: Command = {
  data: new SlashCommandBuilder()
    .setName('move')
    .setDescription('Move a queued track to a new position.')
    .addIntegerOption((opt) =>
      opt.setName('from').setDescription('Current queue position.').setRequired(true).setMinValue(1),
    )
    .addIntegerOption((opt) =>
      opt.setName('to').setDescription('New queue position.').setRequired(true).setMinValue(1),
    ),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!(await isDj(interaction))) {
      await replyError(interaction, 'You need the DJ role to reorder the queue.');
      return;
    }

    const player = getPlayer(interaction);
    if (!player) {
      await replyError(interaction, 'Nothing is playing.');
      return;
    }

    const len = player.queue.tracks.length;
    const from = interaction.options.getInteger('from', true);
    const to = interaction.options.getInteger('to', true);
    if (from > len || to > len) {
      await replyError(interaction, `The queue only has **${len}** upcoming track(s).`);
      return;
    }
    if (from === to) {
      await replyOk(interaction, 'That track is already in that position.');
      return;
    }

    const track = player.queue.tracks[from - 1]!;
    await player.queue.splice(from - 1, 1); // remove it
    await player.queue.splice(to - 1, 0, track); // re-insert at the new spot
    await replyOk(interaction, `↕️ Moved **${track.info?.title ?? 'track'}** to position **${to}**.`);
    void refreshPanel(player, true);
  },
};
