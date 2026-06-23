import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { listFavorites } from '../db/favorites.js';
import { getVoiceContext, replyError } from '../lib/interactions.js';
import { logger } from '../lib/logger.js';
import type { Command } from '../lib/types.js';
import { getOrCreatePlayer } from '../music/QueueManager.js';
import { resolve } from '../music/sources.js';

/**
 * /favorites — list and replay your saved tracks (doc roadmap, "favorites").
 * Tracks are saved per-user with the ⭐ button on the now-playing card.
 */
export const favorites: Command = {
  data: new SlashCommandBuilder()
    .setName('favorites')
    .setDescription('Your saved favorite tracks.')
    .addSubcommand((sub) => sub.setName('list').setDescription('List your favorites.'))
    .addSubcommand((sub) =>
      sub
        .setName('play')
        .setDescription('Play one of your favorites by its number.')
        .addIntegerOption((opt) =>
          opt
            .setName('number')
            .setDescription('Number shown in /favorites list.')
            .setRequired(true)
            .setMinValue(1),
        ),
    ),
  async execute(interaction) {
    if (interaction.options.getSubcommand() === 'list') {
      const favs = await listFavorites(interaction.user.id);
      if (favs.length === 0) {
        await replyError(interaction, 'You have no favorites yet — tap ⭐ on a now-playing card.');
        return;
      }
      const lines = favs.map(
        (f, i) => `\`${i + 1}.\` [${f.title}](${f.uri})${f.author ? ` — ${f.author}` : ''}`,
      );
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('⭐ Your favorites')
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Play one with /favorites play number:<n>' });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    // play
    await interaction.deferReply();
    const number = interaction.options.getInteger('number', true);
    const favs = await listFavorites(interaction.user.id);
    const fav = favs[number - 1];
    if (!fav) {
      await replyError(interaction, `You don't have a favorite #${number}.`);
      return;
    }

    const voice = await getVoiceContext(interaction);
    if (!voice) return;

    try {
      const player = await getOrCreatePlayer(interaction, voice.voiceChannel.id);
      const result = await resolve(player, fav.uri, interaction.user);
      if (!result.tracks.length) {
        await replyError(interaction, `Couldn't load **${fav.title}**.`);
        return;
      }
      const track = result.tracks[0]!;
      player.queue.add(track);
      if (!player.playing && !player.paused) await player.play();
      await interaction.editReply(`🎶 Added **${track.info.title}** from your favorites.`);
    } catch (err) {
      logger.error({ err, guildId: interaction.guildId }, 'favorites play failed');
      await replyError(interaction, 'Something went wrong playing that favorite.');
    }
  },
};
