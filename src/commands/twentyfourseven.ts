import { SlashCommandBuilder } from 'discord.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getPlayer } from '../music/QueueManager.js';
import { clear247State, persist247State } from '../music/rejoin.js';

/**
 * /24-7 — keep the bot in voice when the queue ends. The `mode` chooses what
 * happens when the channel empties:
 *   • until-empty (default): stay through queue-end, but LEAVE if nobody's left.
 *   • forever: stay no matter what — even an empty channel (set-and-forget).
 *   • off: normal (leave shortly after the queue ends).
 *
 * With no `mode`, it toggles between until-empty and off. Flags live on the
 * player: `247` (stay on queue-end) and `247Forever` (also ignore empty-channel,
 * honoured in events/voiceStateUpdate.ts).
 */
export const twentyfourseven: Command = {
  data: new SlashCommandBuilder()
    .setName('24-7')
    .setDescription('Stay in voice when the queue ends (24/7 mode).')
    .addStringOption((opt) =>
      opt
        .setName('mode')
        .setDescription('How long to stay (default: toggle until-empty).')
        .addChoices(
          { name: 'until-empty — stay, but leave if the channel empties', value: 'until-empty' },
          { name: 'forever — stay even in an empty channel', value: 'forever' },
          { name: 'off', value: 'off' },
        ),
    ),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!(await isDj(interaction))) {
      await replyError(interaction, 'You need the DJ role to change 24/7 mode.');
      return;
    }

    const player = getPlayer(interaction);
    if (!player) {
      await replyError(interaction, 'Nothing is playing — start something first, then enable 24/7.');
      return;
    }

    // No mode → toggle between until-empty and off.
    const requested = interaction.options.getString('mode');
    const mode = requested ?? (player.get<boolean>('247') ? 'off' : 'until-empty');

    if (mode === 'off') {
      player.set('247', false);
      player.set('247Forever', false);
      void clear247State(interaction.guildId!); // stop auto-rejoining on restart
      await replyOk(interaction, '⏹️ **24/7 off** — I’ll leave shortly after the queue ends.');
      return;
    }

    player.set('247', true);
    player.set('247Forever', mode === 'forever');
    // Cancel any queue-empty disconnect that may already be ticking.
    const pending = player.get<NodeJS.Timeout | undefined>('internal_queueempty');
    if (pending) clearTimeout(pending);
    player.set('internal_queueempty', undefined);

    // Persist so the bot rejoins this channel on restart (auto-rejoin on boot).
    if (player.voiceChannelId) {
      void persist247State(interaction.guildId!, {
        voiceChannelId: player.voiceChannelId,
        textChannelId: player.textChannelId ?? interaction.channelId,
        forever: mode === 'forever',
      });
    }

    await replyOk(
      interaction,
      mode === 'forever'
        ? '♾️ **24/7: forever** — I’ll stay in the channel no matter what (even if empty). Use `/24-7 mode:off` to stop.'
        : '♾️ **24/7: until-empty** — I’ll stay when the queue ends, but leave if everyone does.',
    );
  },
};
