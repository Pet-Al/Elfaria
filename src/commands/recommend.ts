import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Player, SearchResult, Track } from 'lavalink-client';
import { coPlayedAfter } from '../analytics/recommend.js';
import { userTopAuthors, userTopTracks } from '../analytics/taste.js';
import { getLastPlayed } from '../db/history.js';
import { getVoiceContext, isDj, replyError } from '../lib/interactions.js';
import { logger } from '../lib/logger.js';
import type { Command } from '../lib/types.js';
import { recommendTracks } from '../ml/recommender.js';
import { getOrCreatePlayer } from '../music/QueueManager.js';

/**
 * /recommend — queue a handful of tracks picked *for you*, blending every signal
 * Elfaria has: the trained item2vec neighbours of a seed, this guild's co-play
 * history, and your personal taste profile — falling back to a search off your
 * favourite artist when the data is thin. The seed is whatever's playing, else
 * your most-played track, else the guild's last-played one.
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
      const top = await userTopTracks(userId, 8);
      const seedUri =
        player.queue.current?.info.uri ?? top[0]?.uri ?? (await getLastPlayed(guildId))?.uri;
      if (!seedUri) {
        await replyError(
          interaction,
          'Not enough listening history yet — play a few tracks first, then try again.',
        );
        return;
      }

      // Gather candidate URIs from every signal, de-duped, with the seed removed.
      const candidateUris = new Set<string>();
      for (const r of recommendTracks(seedUri, 12)) candidateUris.add(r.uri);
      for (const c of await coPlayedAfter(guildId, seedUri, 12)) candidateUris.add(c.uri);
      for (const t of top) candidateUris.add(t.uri);
      candidateUris.delete(seedUri);

      // Never re-recommend what's already queued.
      const queued = new Set(
        [player.queue.current?.info.uri, ...(player.queue.tracks as Track[]).map((t) => t.info.uri)]
          .filter((u): u is string => Boolean(u)),
      );

      const picks: Track[] = [];
      for (const uri of candidateUris) {
        if (picks.length >= count) break;
        if (queued.has(uri)) continue;
        const track = await searchOne(player, uri, requester);
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
