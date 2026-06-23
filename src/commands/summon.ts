import { GuildMember, SlashCommandBuilder } from 'discord.js';
import { isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getOrCreatePlayer, getPlayer } from '../music/QueueManager.js';

/**
 * /summon — move (or connect) Elfaria to the invoker's voice channel. DJ-gated.
 * Unlike other commands it deliberately allows a *different* channel from the
 * bot's current one — that's the whole point.
 */
export const summon: Command = {
  data: new SlashCommandBuilder()
    .setName('summon')
    .setDescription('Move Elfaria to your voice channel.'),
  async execute(interaction) {
    const member = interaction.member;
    if (!(member instanceof GuildMember) || !member.voice.channel) {
      await replyError(interaction, 'You need to be in a voice channel.');
      return;
    }
    if (!(await isDj(interaction))) {
      await replyError(interaction, 'You need the DJ role to move the bot.');
      return;
    }

    const target = member.voice.channel;
    const player = getPlayer(interaction);
    if (player) {
      if (player.voiceChannelId === target.id) {
        await replyOk(interaction, `I'm already in **${target.name}**.`);
        return;
      }
      await player.changeVoiceState({ voiceChannelId: target.id });
      await replyOk(interaction, `➡️ Moved to **${target.name}**.`);
      return;
    }

    await getOrCreatePlayer(interaction, target.id);
    await replyOk(interaction, `👋 Joined **${target.name}**.`);
  },
};
