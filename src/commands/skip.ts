import { SlashCommandBuilder } from 'discord.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getPlayer } from '../music/QueueManager.js';

export const skip: Command = {
  data: new SlashCommandBuilder().setName('skip').setDescription('Skip the current track.'),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!isDj(interaction)) {
      await replyError(interaction, 'You need the DJ role to skip.');
      return;
    }

    const player = getPlayer(interaction);
    if (!player?.queue.current) {
      await replyError(interaction, 'Nothing is playing.');
      return;
    }

    const current = player.queue.current;
    // skip() throws when there's no next track; stop instead so the queue ends.
    if (player.queue.tracks.length > 0) await player.skip();
    else await player.stopPlaying();

    await replyOk(interaction, `⏭️ Skipped **${current.info.title}**.`);
  },
};
