import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { ElfariaClient } from '../client.js';
import { config } from '../config.js';
import { getVoiceContext, replyError } from '../lib/interactions.js';
import { logger } from '../lib/logger.js';
import type { Command } from '../lib/types.js';
import { getOrCreatePlayer, leaveIfIdle } from '../music/QueueManager.js';
import { refreshPanel } from '../music/player.js';
import { resolve } from '../music/sources.js';

/**
 * /play — the heart of the bot (doc §3–§5, milestone 4).
 *
 * Honours the 3-second rule: defer first, then create/connect the Lavalink
 * player, resolve the query through the sourcing layer, enqueue, and start
 * playback if idle. The "now playing" announcement is emitted by the trackStart
 * Lavalink event (music/player.ts); here we just acknowledge the enqueue.
 */

/**
 * If Spotify is OFF and the query is a Spotify request, returns the opt-in hint.
 * When Spotify IS configured we return null so the caller surfaces the real
 * error (e.g. an unsupported playlist) instead of wrongly claiming it's off.
 */
function spotifyHint(query: string): string | null {
  if (config.spotify.enabled) return null;
  if (/open\.spotify\.com|spotify:|^\s*spsearch:/i.test(query)) {
    return (
      "Spotify isn't enabled on this bot yet. The host needs to add Spotify API " +
      'credentials (see the README → “Enabling Spotify”). YouTube and ' +
      'SoundCloud links/searches work in the meantime.'
    );
  }
  return null;
}
export const play: Command = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song or playlist (search text or a link).')
    .addStringOption((opt) =>
      opt
        .setName('query')
        .setDescription('Song name or URL (YouTube, SoundCloud, Spotify…)')
        .setRequired(true)
        .setAutocomplete(true),
    ),

  /**
   * Typeahead suggestions (the dropdown shown while typing the query). Searches
   * Lavalink directly via a node — no player/voice connection needed yet — and
   * returns up to 5 matches. The selected option's value is the track URL, so
   * /play receives a direct link and resolves instantly. Fails soft: any error
   * just yields no suggestions rather than breaking the typing experience.
   */
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    if (focused.length < 2 || /^https?:\/\//i.test(focused)) {
      await interaction.respond([]);
      return;
    }

    try {
      const node = (interaction.client as ElfariaClient).lavalink.nodeManager.leastUsedNodes()[0];
      if (!node?.connected) {
        await interaction.respond([]);
        return;
      }

      const result = await node.search(
        { query: focused, source: config.music.searchPlatform as never },
        interaction.user,
      );
      const choices = result.tracks.slice(0, 5).map((track) => ({
        name: `${track.info.title} — ${track.info.author}`.slice(0, 100),
        value:
          track.info.uri && track.info.uri.length <= 100
            ? track.info.uri
            : track.info.title.slice(0, 100),
      }));
      await interaction.respond(choices);
    } catch {
      await interaction.respond([]);
    }
  },

  async execute(interaction) {
    // Ephemeral: the public surface is the now-playing card (which shows the
    // queue), so /play just acknowledges privately instead of spamming the
    // channel with an "added to queue" message for every track.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const voice = await getVoiceContext(interaction);
    if (!voice) return;

    const query = interaction.options.getString('query', true);

    try {
      const player = await getOrCreatePlayer(interaction, voice.voiceChannel.id);
      const wasActive = player.playing || player.paused;
      const result = await resolve(player, query, interaction.user);

      // Lavalink couldn't load the source (e.g. a broken/unsupported link).
      if (result.loadType === 'error') {
        const reason = result.exception?.message ?? 'the source returned an error';
        await leaveIfIdle(player); // don't sit idle in voice after a failed load
        await replyError(interaction, spotifyHint(query) ?? `Couldn't load that — ${reason}.`);
        return;
      }

      if (!result.tracks.length) {
        await leaveIfIdle(player);
        await replyError(interaction, spotifyHint(query) ?? `No results found for **${query}**.`);
        return;
      }

      if (result.loadType === 'playlist') {
        player.queue.add(result.tracks);
        await interaction.editReply(
          `🎶 Queued **${result.tracks.length}** tracks from **${result.playlist?.title ?? 'playlist'}**.`,
        );
      } else {
        const track = result.tracks[0]!;
        player.queue.add(track);
        await interaction.editReply(
          wasActive
            ? `🎶 Added **${track.info.title}** to the queue (#${player.queue.tracks.length}).`
            : `▶️ Playing **${track.info.title}**.`,
        );
      }

      if (!player.playing && !player.paused) await player.play();
      // Already playing → the new track only changed the queue, so update the
      // existing now-playing card's "up next" in place instead of posting anew.
      else void refreshPanel(player, true);
    } catch (err) {
      logger.error({ err, guildId: interaction.guildId, query }, 'failed to start playback');
      const player = (interaction.client as ElfariaClient).lavalink.getPlayer(interaction.guildId!);
      if (player) await leaveIfIdle(player);
      await replyError(
        interaction,
        spotifyHint(query) ??
          'Something went wrong trying to play that. The audio service may be unavailable.',
      );
    }
  },
};
