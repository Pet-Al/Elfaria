import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Track } from 'lavalink-client';
import {
  deletePlaylist,
  listPlaylists,
  loadPlaylistTracks,
  type SavedTrack,
  savePlaylist,
} from '../db/playlists.js';
import { getVoiceContext, replyError, replyOk } from '../lib/interactions.js';
import { logger } from '../lib/logger.js';
import type { Command } from '../lib/types.js';
import { formatDuration, getOrCreatePlayer, getPlayer } from '../music/QueueManager.js';
import { resolve } from '../music/sources.js';

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
      const playlists = await listPlaylists(guildId, userId);
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
      const ok = await deletePlaylist(guildId, userId, name);
      if (ok) await replyOk(interaction, `🗑️ Deleted playlist **${name}**.`);
      else await replyError(interaction, `You have no playlist named **${name}**.`);
      return;
    }

    if (sub === 'save') {
      const name = interaction.options.getString('name', true);
      const player = getPlayer(interaction);
      if (!player || (!player.queue.current && player.queue.tracks.length === 0)) {
        await replyError(interaction, 'Nothing is playing to save.');
        return;
      }

      const source = [player.queue.current, ...(player.queue.tracks as Track[])].filter(
        (t): t is Track => t != null,
      );
      const tracks: SavedTrack[] = source.map((t) => ({
        title: t.info.title,
        url: t.info.uri,
        duration: t.info.isStream ? null : formatDuration(t.info.duration),
      }));

      await savePlaylist(guildId, userId, name, tracks);
      await replyOk(interaction, `💾 Saved **${tracks.length}** track(s) as **${name}**.`);
      return;
    }

    if (sub === 'load') {
      await interaction.deferReply();

      const voice = await getVoiceContext(interaction);
      if (!voice) return;

      const name = interaction.options.getString('name', true);
      const saved = await loadPlaylistTracks(guildId, userId, name);
      if (!saved || saved.length === 0) {
        await replyError(interaction, `You have no playlist named **${name}**.`);
        return;
      }

      try {
        const player = await getOrCreatePlayer(interaction, voice.voiceChannel.id);
        let added = 0;
        for (const track of saved) {
          const result = await resolve(player, track.url, interaction.user);
          if (result.tracks.length) {
            player.queue.add(result.tracks[0]!);
            added += 1;
          }
        }

        if (added === 0) {
          await replyError(interaction, 'Could not load any tracks from that playlist.');
          return;
        }

        if (!player.playing && !player.paused) await player.play();
        await interaction.editReply(`▶️ Loaded **${added}** track(s) from **${name}**.`);
      } catch (err) {
        logger.error({ err, guildId, name }, 'failed to load playlist');
        await replyError(interaction, 'Something went wrong loading that playlist.');
      }
    }
  },
};
