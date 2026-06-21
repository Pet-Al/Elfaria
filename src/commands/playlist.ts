import { useMainPlayer } from 'discord-player';
import { EmbedBuilder, type GuildTextBasedChannel, SlashCommandBuilder } from 'discord.js';
import {
  deletePlaylist,
  listPlaylists,
  loadPlaylistTracks,
  type SavedTrack,
  savePlaylist,
} from '../db/playlists.js';
import { getVoiceContext, replyError, replyOk } from '../lib/interactions.js';
import { logger } from '../lib/logger.js';
import type { Command, QueueMetadata } from '../lib/types.js';
import { buildNodeOptions, getQueue } from '../music/QueueManager.js';

/**
 * Saved playlists (doc §6). The durable feature that justifies the database:
 * snapshot the current queue under a name, reload it later, surviving restarts.
 */
export const playlist: Command = {
  data: new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('Save, load, and manage your playlists.')
    .addSubcommand((sub) =>
      sub
        .setName('save')
        .setDescription('Save the current queue as a named playlist.')
        .addStringOption((opt) =>
          opt.setName('name').setDescription('A name for the playlist.').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('load')
        .setDescription('Load one of your playlists into the queue.')
        .addStringOption((opt) =>
          opt.setName('name').setDescription('The playlist to load.').setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List your saved playlists.'))
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Delete one of your playlists.')
        .addStringOption((opt) =>
          opt.setName('name').setDescription('The playlist to delete.').setRequired(true),
        ),
    ),

  async execute(interaction) {
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const playlists = listPlaylists(guildId, userId);
      if (playlists.length === 0) {
        await replyError(interaction, 'You have no saved playlists. Use `/playlist save`.');
        return;
      }
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('📂 Your playlists')
        .setDescription(
          playlists.map((p) => `• **${p.name}** — ${p.trackCount} track(s)`).join('\n'),
        );
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'delete') {
      const name = interaction.options.getString('name', true);
      const ok = deletePlaylist(guildId, userId, name);
      if (ok) await replyOk(interaction, `🗑️ Deleted playlist **${name}**.`);
      else await replyError(interaction, `You have no playlist named **${name}**.`);
      return;
    }

    if (sub === 'save') {
      const name = interaction.options.getString('name', true);
      const queue = getQueue(guildId);
      if (!queue || (!queue.currentTrack && queue.tracks.size === 0)) {
        await replyError(interaction, 'Nothing is playing to save.');
        return;
      }

      const source = [queue.currentTrack, ...queue.tracks.toArray()].filter(
        (t): t is NonNullable<typeof t> => t != null,
      );
      const tracks: SavedTrack[] = source.map((t) => ({
        title: t.title,
        url: t.url,
        duration: t.duration || null,
      }));

      savePlaylist(guildId, userId, name, tracks);
      await replyOk(interaction, `💾 Saved **${tracks.length}** track(s) as **${name}**.`);
      return;
    }

    if (sub === 'load') {
      await interaction.deferReply();

      const voice = await getVoiceContext(interaction);
      if (!voice) return;

      const name = interaction.options.getString('name', true);
      const saved = loadPlaylistTracks(guildId, userId, name);
      if (!saved || saved.length === 0) {
        await replyError(interaction, `You have no playlist named **${name}**.`);
        return;
      }

      const metadata: QueueMetadata = {
        channel: interaction.channel as GuildTextBasedChannel,
        requestedBy: interaction.user,
      };
      const player = useMainPlayer();

      try {
        // Play the first track to establish the connection + queue, then add the rest.
        await player.play(voice.voiceChannel, saved[0]!.url, {
          nodeOptions: buildNodeOptions(guildId, metadata),
          requestedBy: interaction.user,
        });

        const queue = getQueue(guildId);
        let added = 1;
        for (const track of saved.slice(1)) {
          const result = await player.search(track.url, { requestedBy: interaction.user });
          if (queue && result.hasTracks()) {
            queue.addTrack(result.tracks[0]!);
            added += 1;
          }
        }

        await interaction.editReply(`▶️ Loaded **${added}** track(s) from **${name}**.`);
      } catch (err) {
        logger.error({ err, guildId, name }, 'failed to load playlist');
        await replyError(interaction, 'Something went wrong loading that playlist.');
      }
    }
  },
};
