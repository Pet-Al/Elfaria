import { SlashCommandBuilder } from 'discord.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { rerollAutoplay } from '../music/autoplay.js';
import { getPlayer } from '../music/QueueManager.js';
import { refreshPanel } from '../music/player.js';

/**
 * /reroll — don't like what autoplay queued up? Swap every autoplay-added track
 * for a fresh, different shuffle of related songs (anything you queued manually
 * is kept). Enables autoplay if it was off, since rerolling implies you want it.
 */
export const reroll: Command = {
  data: new SlashCommandBuilder()
    .setName('reroll')
    .setDescription('Shuffle up a fresh set of autoplay tracks (keeps your own queued songs).'),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!(await isDj(interaction))) {
      await replyError(interaction, 'You need the DJ role to reroll autoplay.');
      return;
    }

    const player = getPlayer(interaction);
    const current = player?.queue.current;
    if (!player || !current) {
      await replyError(interaction, 'Nothing is playing to base recommendations on.');
      return;
    }

    // Rerolling implies you want autoplay — turn it on if it was off.
    if (!player.get<boolean>('autoplay')) player.set('autoplay', true);

    const added = await rerollAutoplay(player, current);
    void refreshPanel(player);

    if (added === 0) {
      await replyError(interaction, "Couldn't find fresh tracks to queue right now — try again.");
      return;
    }
    await replyOk(interaction, `🎲 Rerolled autoplay — queued **${added}** fresh track${added === 1 ? '' : 's'}.`);
  },
};
