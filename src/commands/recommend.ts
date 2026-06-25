import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Player, SearchResult, Track } from 'lavalink-client';
import { userTopAuthors, userTopTracks } from '../analytics/taste.js';
import { getLastPlayed } from '../db/history.js';
import { getVoiceContext, isDj, replyError } from '../lib/interactions.js';
import { logger } from '../lib/logger.js';
import type { Command } from '../lib/types.js';
import { recommend as buildRecommendations } from '../ml/recsys/index.js';
import { getOrCreatePlayer } from '../music/QueueManager.js';

/**
 * /recommend — queue a handful of tracks picked *for you*. It runs the multi-
 * signal recommender (src/ml/recsys): collaborative filtering (co-play +
 * item2vec), the session model, the NLP/semantic signal, a popularity prior, and
 * an audio-similarity re-rank — fused by the BaRT-style blender. The seed is
 * whatever's playing, else your most-played track, else the guild's last-played
 * one; a search off your favourite artist tops up when the data is thin.
 */

const DEFAULT_COUNT = 5;
const MAX_COUNT = 10;

type Requester = { id: string; username: string };

async function searchOne(
  player: Player,
  query: string,
  requester: Requester,
): Promise<Track | undefined> {
  const res = (await player.search({ query }, requester)) as SearchResult;
  return res.tracks[0];
}

export const recommend: Command = {
  data: new SlashCommandBuilder()
    .setName('recommend')
    .setDescription('Queue tracks picked for you (your taste + what plays well here).')
    .addIntegerOption((opt) =>
      opt
        .setName('count')
        .setDescription(`How many to add (1–${MAX_COUNT}, default ${DEFAULT_COUNT}).`)
        .setMinValue(1)
        .setMaxValue(MAX_COUNT),
    ),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!(await isDj(interaction))) {
      await replyError(interaction, 'You need the DJ role to queue recommendations.');
      return;
    }

    const guildId = interaction.guildId!;
    const userId = interaction.user.id;
    const count = interaction.options.getInteger('count') ?? DEFAULT_COUNT;

    await interaction.deferReply();
    try {
      const player = await getOrCreatePlayer(interaction, voice.voiceChannel.id);
      const requester: Requester = { id: userId, username: interaction.user.username };

      // Seed: what's playing → your top track → the guild's last-played track.
      const current = player.queue.current;
      const top = await userTopTracks(userId, 8);
      const lastPlayed = current ? undefined : await getLastPlayed(guildId);
      const seedUri = current?.info.uri ?? top[0]?.uri ?? lastPlayed?.uri;
      if (!seedUri) {
        await replyError(
          interaction,
          'Not enough listening history yet — play a few tracks first, then try again.',
        );
        return;
      }

      // Never re-recommend what's already queued (or the seed).
      const queued = new Set(
        [current?.info.uri, ...(player.queue.tracks as Track[]).map((t) => t.info.uri)].filter(
          (u): u is string => Boolean(u),
        ),
      );

      // The session model's input: recently-played tracks this session, oldest
      // first (lavalink keeps a "previous" stack), with the current track last.
      const previous = (player.queue.previous as Track[] | undefined) ?? [];
      const sessionUris = [...previous].reverse().map((t) => t.info.uri).filter(Boolean);
      if (current?.info.uri) sessionUris.push(current.info.uri);

      // Run the multi-signal recommender + BaRT blender; over-fetch so we can
      // drop any URI that fails to re-resolve into a playable track.
      const ranked = await buildRecommendations({
        guildId,
        userId,
        seedUri,
        seedTitle: current?.info.title,
        seedAuthor: current?.info.author ?? top[0]?.author ?? null,
        sessionUris,
        exclude: queued,
        limit: count * 3,
      });

      const picks: Track[] = [];
      for (const rec of ranked) {
        if (picks.length >= count) break;
        const track = await searchOne(player, rec.uri, requester);
        if (track?.info.uri && !queued.has(track.info.uri)) {
          picks.push(track);
          queued.add(track.info.uri);
        }
      }

      // Thin data? Top up from a search off the listener's favourite artist.
      const authors = await userTopAuthors(userId, 3);
      if (picks.length < count && authors.length > 0) {
        const res = (await player.search(
          { query: `ytsearch:${authors[0]} mix` },
          requester,
        )) as SearchResult;
        for (const track of res.tracks) {
          if (picks.length >= count) break;
          if (track.info.uri && !queued.has(track.info.uri) && !track.info.isStream) {
            picks.push(track);
            queued.add(track.info.uri);
          }
        }
      }

      if (picks.length === 0) {
        await replyError(interaction, "Couldn't find anything fresh to recommend right now.");
        return;
      }

      await player.queue.add(picks);
      if (!player.playing && !player.paused) await player.play();

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`✨ Recommended ${picks.length} track${picks.length === 1 ? '' : 's'} for you`)
        .setDescription(picks.map((t, i) => `\`#${i + 1}\` **${t.info.title}**`).join('\n'));
      if (authors.length > 0) {
        embed.setFooter({ text: `Based on your taste — top artists: ${authors.join(', ')}` });
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error({ err, guildId, userId }, 'recommend failed');
      await replyError(interaction, 'Something went wrong building your recommendations.');
    }
  },
};
