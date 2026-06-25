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
        .setDescription('Play one of your favorites (type to search, or give its number).')
        .addStringOption((opt) =>
          opt
            .setName('track')
            .setDescription('Start typing to pick a favorite — or its number from /favorites list.')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    ),

  /**
   * Typeahead over the user's OWN favorites. Filters by title/author substring
   * (and matches a typed number), so picking is name-based instead of memorising
   * an index. The option value is the favorite's URI (so it resolves directly);
   * for the rare over-100-char URI we fall back to a `fav:<n>` index sentinel.
   */
  async autocomplete(interaction) {
    try {
      const focused = interaction.options.getFocused().toLowerCase().trim();
      const favs = await listFavorites(interaction.user.id);
      const choices = favs
        .map((f, i) => ({ f, i }))
        .filter(
          ({ f, i }) =>
            !focused ||
            f.title.toLowerCase().includes(focused) ||
            (f.author ?? '').toLowerCase().includes(focused) ||
            String(i + 1) === focused,
        )
        .slice(0, 25)
        .map(({ f, i }) => ({
          name: `${i + 1}. ${f.title}${f.author ? ` — ${f.author}` : ''}`.slice(0, 100),
          value: f.uri.length <= 100 ? f.uri : `fav:${i + 1}`,
        }));
      await interaction.respond(choices);
    } catch {
      await interaction.respond([]);
    }
  },

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
        .setFooter({ text: 'Play one with /favorites play — type to search or give its number.' });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    // play
    await interaction.deferReply();
    const choice = interaction.options.getString('track', true).trim();
    const favs = await listFavorites(interaction.user.id);
    // Resolve the autocomplete value (a URI), a typed number, or a `fav:<n>`
    // sentinel — all back to one saved favorite.
    let fav = favs.find((f) => f.uri === choice);
    if (!fav && /^\d+$/.test(choice)) fav = favs[Number(choice) - 1];
    if (!fav && choice.startsWith('fav:')) fav = favs[Number(choice.slice(4)) - 1];
    if (!fav) {
      await replyError(
        interaction,
        favs.length === 0
          ? 'You have no favorites yet — tap ⭐ on a now-playing card.'
          : "Couldn't find that in your favorites — pick one from the suggestions or use its number.",
      );
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
