import { SlashCommandBuilder } from 'discord.js';
import { setAppSetting } from '../db/appSettings.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { clearAutoplayQueued, fillAutoplayBuffer } from '../music/autoplay.js';
import { autoplayKey, getPlayer } from '../music/QueueManager.js';
import { refreshPanel } from '../music/player.js';

/**
 * Toggle autoplay: when the queue runs low, keep playing related tracks. The
 * flag lives on the player; the engine in music/autoplay.ts acts on it.
 *
 * Turning it ON immediately fills the buffer so the picks show in "up next"
 * right away (not only once the queue swaps to them). Turning it OFF dequeues
 * the autoplay picks (keeping anything you queued yourself), so you can play
 * something else cleanly.
 */
export const autoplay: Command = {
  data: new SlashCommandBuilder()
    .setName('autoplay')
    .setDescription('Toggle autoplay (keep playing related tracks when the queue ends).'),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!(await isDj(interaction))) {
      await replyError(interaction, 'You need the DJ role to change autoplay.');
      return;
    }

    const player = getPlayer(interaction);
    if (!player) {
      await replyError(interaction, 'Nothing is playing.');
      return;
    }

    const enabled = !player.get<boolean>('autoplay');
    player.set('autoplay', enabled);
    // Persist per guild so it survives a restart / new player (applied in ensurePlayer).
    void setAppSetting(autoplayKey(interaction.guildId!), enabled ? 'true' : 'false');

    if (enabled) {
      const seed = player.queue.current;
      const added = seed ? await fillAutoplayBuffer(player, seed) : 0;
      void refreshPanel(player, true);
      await replyOk(
        interaction,
        added > 0
          ? `♾️ Autoplay **enabled** — queued **${added}** related track${added === 1 ? '' : 's'} up next.`
          : '♾️ Autoplay **enabled**.',
      );
    } else {
      const removed = await clearAutoplayQueued(player);
      void refreshPanel(player, true);
      await replyOk(
        interaction,
        removed > 0
          ? `⏹️ Autoplay **disabled** — removed **${removed}** autoplay track${removed === 1 ? '' : 's'} from the queue.`
          : '⏹️ Autoplay **disabled**.',
      );
    }
  },
};
