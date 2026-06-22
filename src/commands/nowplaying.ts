import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { replyError } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { getPlayer } from '../music/QueueManager.js';
import { nowPlayingCard, nowPlayingEmbed } from '../music/nowPlayingCard.js';

export const nowplaying: Command = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Show the track currently playing.')
    .addBooleanOption((option) =>
      option
        .setName('legacy')
        .setDescription('Show the classic embed view instead of the modern card.'),
    ),
  async execute(interaction) {
    const player = getPlayer(interaction);
    if (!player?.queue.current) {
      await replyError(interaction, 'Nothing is playing.');
      return;
    }

    const track = player.queue.current;

    // Default: the modern Components V2 card (a live snapshot — no buttons, since
    // the persistent control panel already lives on the auto-posted message).
    // `legacy:true` falls back to the classic embed.
    if (interaction.options.getBoolean('legacy')) {
      await interaction.reply({ embeds: [nowPlayingEmbed(track, player.position)] });
      return;
    }

    await interaction.reply({
      flags: MessageFlags.IsComponentsV2,
      components: [nowPlayingCard(track, { positionMs: player.position, withControls: false })],
    });
  },
};
