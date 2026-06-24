import { SlashCommandBuilder } from 'discord.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { clearAutoplayQueued } from '../music/autoplay.js';
import { getPlayer } from '../music/QueueManager.js';
import { refreshPanel } from '../music/player.js';

/**
 * /dequeue — remove the autoplay-added tracks from the queue (keeping anything
 * you queued yourself). A standalone version of `/autoplay when-off:dequeue`,
 * for when you left autoplay on and want to clear its picks without toggling.
 */
export const dequeue: Command = {
  data: new SlashCommandBuilder()
    .setName('autoplay-dequeue')
    .setDescription('Remove autoplay-added tracks from the queue (keeps your own).'),
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

    const removed = await clearAutoplayQueued(player);
    void refreshPanel(player, true);
    await replyOk(
      interaction,
      removed > 0
        ? `🧹 Removed **${removed}** autoplay track${removed === 1 ? '' : 's'} from the queue.`
        : 'No autoplay tracks in the queue to remove.',
    );
  },
};
