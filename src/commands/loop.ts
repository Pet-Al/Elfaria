import { QueueRepeatMode } from 'discord-player';
import { SlashCommandBuilder } from 'discord.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getQueue } from '../music/QueueManager.js';

const MODES: Record<string, QueueRepeatMode> = {
  off: QueueRepeatMode.OFF,
  track: QueueRepeatMode.TRACK,
  queue: QueueRepeatMode.QUEUE,
  autoplay: QueueRepeatMode.AUTOPLAY,
};

export const loop: Command = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Set the repeat mode.')
    .addStringOption((opt) =>
      opt
        .setName('mode')
        .setDescription('Repeat mode.')
        .setRequired(true)
        .addChoices(
          { name: 'Off', value: 'off' },
          { name: 'Current track', value: 'track' },
          { name: 'Whole queue', value: 'queue' },
          { name: 'Autoplay (recommendations)', value: 'autoplay' },
        ),
    ),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!isDj(interaction)) {
      await replyError(interaction, 'You need the DJ role to change the repeat mode.');
      return;
    }

    const queue = getQueue(interaction.guildId!);
    if (!queue) {
      await replyError(interaction, 'Nothing is playing.');
      return;
    }

    const mode = interaction.options.getString('mode', true);
    queue.setRepeatMode(MODES[mode] ?? QueueRepeatMode.OFF);
    await replyOk(interaction, `🔁 Repeat mode set to **${mode}**.`);
  },
};
