import { SlashCommandBuilder } from 'discord.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getPlayer } from '../music/QueueManager.js';

/**
 * Toggle autoplay: when the queue ends, keep playing related tracks. The flag
 * lives on the player; the engine in music/autoplay.ts acts on it.
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
    await replyOk(interaction, enabled ? '♾️ Autoplay **enabled**.' : '⏹️ Autoplay **disabled**.');
  },
};
