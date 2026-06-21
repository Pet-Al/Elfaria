import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../lib/types.js';

/**
 * The end-to-end smoke test (doc §2, milestone 2). Demonstrates the ack
 * pattern: defer immediately, then edit with the result.
 */
export const ping: Command = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check that the bot is alive and see gateway latency.'),
  cooldownMs: 5000,
  async execute(interaction) {
    await interaction.deferReply();
    const ws = Math.round(interaction.client.ws.ping);
    await interaction.editReply(
      `🏓 Pong! Gateway latency: \`${ws < 0 ? 'measuring…' : `${ws}ms`}\``,
    );
  },
};
