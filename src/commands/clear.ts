import { SlashCommandBuilder } from 'discord.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getPlayer } from '../music/QueueManager.js';
import { refreshPanel } from '../music/player.js';

/** /clear — empty the upcoming queue (keeps the current track playing). DJ-gated. */
export const clear: Command = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear all upcoming tracks (keeps the current song playing).'),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!(await isDj(interaction))) {
      await replyError(interaction, 'You need the DJ role to clear the queue.');
      return;
    }

    const player = getPlayer(interaction);
    if (!player) {
      await replyError(interaction, 'Nothing is playing.');
      return;
    }
    const count = player.queue.tracks.length;
    if (count === 0) {
      await replyError(interaction, 'The queue is already empty.');
      return;
    }

    await player.queue.splice(0, count);
    await replyOk(interaction, `🗑️ Cleared **${count}** track${count === 1 ? '' : 's'} from the queue.`);
    void refreshPanel(player);
  },
};
