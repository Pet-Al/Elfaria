import { SlashCommandBuilder } from 'discord.js';
import { buildReplayPicker } from '../events/historyComponents.js';
import { getVoiceContext, replyError } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';

/**
 * /replay — bring back a previously played track (doc roadmap, "replay").
 * Defaults to the most recent track (a one-click button) but also offers a
 * dropdown to pick any of the recent history. The actual re-queue is handled by
 * the replay:last / replay:pick component handlers (events/historyComponents.ts),
 * which re-resolve the track by URL — robust against stale encoded tracks.
 */
export const replay: Command = {
  data: new SlashCommandBuilder()
    .setName('replay')
    .setDescription('Replay the most recent track — or pick one from history.'),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;

    const picker = await buildReplayPicker(interaction.guildId!);
    if (!picker) {
      await replyError(interaction, 'Nothing has played recently to replay.');
      return;
    }
    await interaction.reply(picker);
  },
};
