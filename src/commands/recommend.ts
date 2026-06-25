import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Player, SearchResult, Track } from 'lavalink-client';
import { userTopTracks } from '../analytics/taste.js';
import { getLastPlayed } from '../db/history.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import { logger } from '../lib/logger.js';
import type { Command } from '../lib/types.js';
import { recommend as buildRecommendations } from '../ml/recsys/index.js';
import { getOrCreatePlayer, getPlayer } from '../music/QueueManager.js';

/**
 * /recommend — queue a handful of FRESH, genre-consistent tracks picked for you.
 *
 * Genre consistency: the picks are anchored to the seed track (what's playing,
 * else your top track, else the guild's last-played one) via its YouTube "mix"
 * radio AND the seed-aware recommender signals (collaborative/session/nlp). The
 * popularity prior is deliberately left OUT when there's a seed — it's what used
 * to drag an EDM seed toward the server's overall favourites (e.g. lofi).
 *
 * Freshness: your own most-played tracks are treated as "familiar" and capped to
 * at most one pick, so a thin history surfaces NEW music in the same vibe instead
 * of just replaying what you already know.
 *
 * `clear:true` removes the tracks a previous /recommend added (keeping your own).
 */

const DEFAULT_COUNT = 5;
const MAX_COUNT = 10;
/** Player store key: identifiers of tracks /recommend queued (for clear). */
const REC_QUEUED = 'recommendQueued';
/** At most this many already-familiar (in your history) picks — keep it fresh. */
const MAX_FAMILIAR = 1;

type Requester = { id: string; username: string };

const idOf = (t: Track): string => t.info.identifier ?? t.info.uri ?? '';

async function searchOne(
  player: Player,
  query: string,
  requester: Requester,
): Promise<Track | undefined> {
  const res = (await player.search({ query }, requester)) as SearchResult;
  return res.tracks[0];
}

/**
 * The seed track's YouTube "mix"/radio — fresh tracks in the SAME genre/vibe as
 * the seed (genre-aware, not same-artist-only). For a YouTube seed we use its
 * video id directly; otherwise we look it up first so Spotify/SoundCloud seeds
 * get the same radio. Streams are dropped (you can't sensibly recommend a live).
 */
async function seedRadio(
  player: Player,
  seed: { uri: string; title?: string; author?: string | null },
  requester: Requester,
): Promise<Track[]> {
  try {
    const current = player.queue.current;
    let videoId: string | null = null;
    if (
      current?.info.uri === seed.uri &&
      (current.info.sourceName === 'youtube' || current.info.sourceName === 'youtubemusic')
    ) {
      videoId = current.info.identifier ?? null;
    }
    if (!videoId) {
      const lookup = (await player.search(
        { query: `${seed.author ?? ''} ${seed.title ?? ''}`.trim() || seed.uri, source: 'ytsearch' as never },
        requester,
      )) as SearchResult;
      videoId = lookup.tracks[0]?.info.identifier ?? null;
    }
    if (!videoId) return [];
    const mix = (await player.search(
      { query: `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}` },
      requester,
    )) as SearchResult;
    return (mix.tracks as Track[]).filter((t) => t.info.uri && !t.info.isStream);
  } catch {
    return [];
  }
}

export const recommend: Command = {
  data: new SlashCommandBuilder()
    .setName('recommend')
    .setDescription('Queue fresh, genre-matched tracks picked for you.')
    .addIntegerOption((opt) =>
      opt
        .setName('count')
        .setDescription(`How many to add (1–${MAX_COUNT}, default ${DEFAULT_COUNT}).`)
        .setMinValue(1)
        .setMaxValue(MAX_COUNT),
    )
    .addBooleanOption((opt) =>
      opt
        .setName('clear')
        .setDescription('Remove the tracks /recommend added (keeps your own).'),
    ),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!(await isDj(interaction))) {
      await replyError(interaction, 'You need the DJ role to manage recommendations.');
      return;
    }

    const guildId = interaction.guildId!;
    const userId = interaction.user.id;

    // ── clear:true → remove the picks a previous /recommend queued ────────────
    if (interaction.options.getBoolean('clear')) {
      const player = getPlayer(interaction);
      const tagged = new Set(player?.get<string[]>(REC_QUEUED) ?? []);
      if (!player || tagged.size === 0) {
        await replyError(interaction, 'No recommended tracks in the queue to clear.');
        return;
      }
      const upcoming = player.queue.tracks as Track[];
      const keep = upcoming.filter((t) => !tagged.has(idOf(t)));
      const removed = upcoming.length - keep.length;
      if (upcoming.length > 0) await player.queue.splice(0, upcoming.length);
      if (keep.length > 0) await player.queue.add(keep);
      player.set(REC_QUEUED, []);
      await replyOk(
        interaction,
        removed > 0
          ? `🧹 Removed **${removed}** recommended track${removed === 1 ? '' : 's'} (kept your own).`
          : 'No recommended tracks left to clear.',
      );
      return;
    }

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
      const seedTitle = current?.info.title ?? top[0]?.title ?? lastPlayed?.title;
      const seedAuthor = current?.info.author ?? top[0]?.author ?? lastPlayed?.author ?? null;
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
      // Your most-played tracks are "familiar" — we cap how many can appear so
      // the set stays fresh rather than replaying your history.
      const familiarUris = new Set((await userTopTracks(userId, 30)).map((t) => t.uri));

      // Session model input: recent in-session plays, oldest first, current last.
      const previous = (player.queue.previous as Track[] | undefined) ?? [];
      const sessionUris = [...previous].reverse().map((t) => t.info.uri).filter(Boolean);
      if (current?.info.uri) sessionUris.push(current.info.uri);

      // Two genre-anchored sources, blended:
      //  1) the seed's radio — fresh, same-vibe tracks (drives genre consistency);
      //  2) the seed-aware recommender signals (NO popularity → no off-genre drift).
      const [radio, ranked] = await Promise.all([
        seedRadio(player, { uri: seedUri, title: seedTitle, author: seedAuthor }, requester),
        buildRecommendations(
          {
            guildId,
            userId,
            seedUri,
            seedTitle,
            seedAuthor,
            sessionUris,
            exclude: queued,
            limit: count * 4,
          },
          { only: ['collaborative', 'session', 'nlp'], epsilon: 0 },
        ),
      ]);

      const picks: Track[] = [];
      let familiar = 0;
      const consider = (track: Track | undefined): void => {
        const uri = track?.info.uri;
        if (!track || !uri || queued.has(uri) || picks.length >= count) return;
        const isFamiliar = familiarUris.has(uri);
        if (isFamiliar && familiar >= MAX_FAMILIAR) return; // keep it fresh
        picks.push(track);
        queued.add(uri);
        if (isFamiliar) familiar += 1;
      };

      // Radio first (fresh + on-genre), then the learned picks (resolve to tracks).
      for (const track of radio) {
        if (picks.length >= count) break;
        consider(track);
      }
      for (const rec of ranked) {
        if (picks.length >= count) break;
        consider(await searchOne(player, rec.uri, requester));
      }
      // Last resort if still short: relax the freshness cap rather than return nothing.
      if (picks.length < count) {
        for (const track of radio) {
          if (picks.length >= count) break;
          const uri = track.info.uri;
          if (uri && !queued.has(uri)) {
            picks.push(track);
            queued.add(uri);
          }
        }
      }

      if (picks.length === 0) {
        await replyError(interaction, "Couldn't find anything fresh to recommend right now.");
        return;
      }

      await player.queue.add(picks);
      // Tag them so `/recommend clear:true` can remove exactly these later.
      const tagged = player.get<string[]>(REC_QUEUED) ?? [];
      player.set(REC_QUEUED, [...tagged, ...picks.map(idOf)]);
      if (!player.playing && !player.paused) await player.play();

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`✨ Recommended ${picks.length} track${picks.length === 1 ? '' : 's'} for you`)
        .setDescription(picks.map((t, i) => `\`#${i + 1}\` **${t.info.title}**`).join('\n'))
        .setFooter({
          text: seedTitle
            ? `Fresh picks in the vibe of “${seedTitle}” · /recommend clear:true to remove them`
            : '/recommend clear:true to remove them',
        });
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error({ err, guildId, userId }, 'recommend failed');
      await replyError(interaction, 'Something went wrong building your recommendations.');
    }
  },
};
