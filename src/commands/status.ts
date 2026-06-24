import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { ElfariaClient } from '../client.js';
import type { Command } from '../lib/types.js';

/**
 * /status — a quick health snapshot inside Discord (the same figures the public
 * HTTP API exposes at /api/stats, but without needing the API enabled): servers,
 * active players, connected Lavalink nodes, gateway latency, and uptime.
 */
function uptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ');
}

export const status: Command = {
  data: new SlashCommandBuilder().setName('status').setDescription('Show Elfaria’s live health stats.'),
  cooldownMs: 0,
  async execute(interaction) {
    const client = interaction.client as ElfariaClient;
    let players = 0;
    for (const p of client.lavalink.players.values()) if (p.playing) players += 1;
    let nodes = 0;
    for (const n of client.lavalink.nodeManager.nodes.values()) if (n.connected) nodes += 1;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🩺 Elfaria status')
      .addFields(
        { name: 'Servers', value: String(client.guilds.cache.size), inline: true },
        { name: 'Active players', value: String(players), inline: true },
        { name: 'Lavalink nodes', value: String(nodes), inline: true },
        { name: 'Gateway', value: `${Math.max(0, Math.round(client.ws.ping))}ms`, inline: true },
        { name: 'Uptime', value: uptime(Math.floor(process.uptime())), inline: true },
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
