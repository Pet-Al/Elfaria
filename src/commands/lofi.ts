import { SlashCommandBuilder } from 'discord.js';
import type { Track } from 'lavalink-client';
import { setAppSetting } from '../db/appSettings.js';
import { getVoiceContext, isDj, replyError, replyOk } from '../lib/interactions.js';
import { logger } from '../lib/logger.js';
import type { Command } from '../lib/types.js';
import { autoplayKey, getOrCreatePlayer } from '../music/QueueManager.js';
import { refreshPanel } from '../music/player.js';
import { resolve } from '../music/sources.js';

/**
 * /lofi — pick a lofi THEME (each its own vibe) and play it continuously.
 *
 * Three deliberate choices, each fixing a past complaint:
 *  - **Per-theme, not one playlist.** Every theme is its own search seed, so
 *    "study" and "synthwave" pull genuinely different music — the user wanted
 *    each theme as a separate parameter, not a one-size-fits-all playlist.
 *  - **Reliable, not live.** We filter OUT livestreams — the 24/7 radio streams
 *    that only sometimes resolve through Lavalink's YouTube clients ("only one
 *    works as live, the rest fail"). Every queued track is a normal, seekable
 *    upload that actually plays.
 *  - **Endless WITHOUT a forced loop.** We enable autoplay instead of
 *    `setRepeatMode('queue')`. The old forced queue-loop is exactly what made it
 *    "never end / loop the last 3 songs"; autoplay keeps pulling fresh related
 *    lofi once the seed batch runs low, and `/autoplay` turns it off cleanly.
 */

interface Theme {
  label: string;
  emoji: string;
  /** A search seed (no live streams) that returns a batch of that vibe. */
  query: string;
}

/** The selectable themes. Add one here and it appears as a /lofi choice. */
const THEMES: Record<string, Theme> = {
  chill: { label: 'Chill', emoji: '🎧', query: 'ytsearch:lofi hip hop chill beats mix' },
  study: { label: 'Study', emoji: '📚', query: 'ytsearch:lofi beats to study and focus mix' },
  sleep: { label: 'Sleep', emoji: '😴', query: 'ytsearch:lofi sleep calm ambient mix' },
  jazz: { label: 'Jazzy', emoji: '🎷', query: 'ytsearch:lofi jazz hop beats mix' },
  chillhop: { label: 'Chillhop', emoji: '🍃', query: 'ytsearch:chillhop instrumental beats mix' },
  synthwave: { label: 'Synthwave', emoji: '🌆', query: 'ytsearch:chillwave synthwave lofi mix' },
  rainy: { label: 'Rainy', emoji: '🌧️', query: 'ytsearch:lofi rain ambience relaxing mix' },
};

const DEFAULT_THEME = 'chill';
/** Cap the initial queue so we don't dump a wall of hour-long mixes in at once. */
const MAX_SEED_TRACKS = 25;

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

export const lofi: Command = {
  data: new SlashCommandBuilder()
    .setName('lofi')
    .setDescription('Play a lofi theme continuously (autoplay keeps it going — no forced loop).')
    .addStringOption((opt) =>
      opt
        .setName('theme')
        .setDescription('Which lofi vibe (default: chill).')
        .addChoices(
          ...Object.entries(THEMES).map(([value, t]) => ({ name: `${t.emoji} ${t.label}`, value })),
        ),
    )
    .addBooleanOption((opt) =>
      opt.setName('shuffle').setDescription('Shuffle the picks (default: true).'),
    ),
  async execute(interaction) {
    const voice = await getVoiceContext(interaction);
    if (!voice) return;
    if (!(await isDj(interaction))) {
      await replyError(interaction, 'You need the DJ role to start lofi mode.');
      return;
    }

    const themeKey = interaction.options.getString('theme') ?? DEFAULT_THEME;
    const theme = THEMES[themeKey] ?? THEMES[DEFAULT_THEME]!;
    const shuffled = interaction.options.getBoolean('shuffle') !== false;

    await interaction.deferReply();
    try {
      const player = await getOrCreatePlayer(interaction, voice.voiceChannel.id);
      const result = await resolve(player, theme.query, interaction.user);
      // Only seekable uploads — drop livestreams (the unreliable 24/7 radios) and
      // anything with no URL.
      let tracks = (result.tracks as Track[]).filter((t) => t.info.uri && !t.info.isStream);
      if (tracks.length === 0) {
        await replyError(
          interaction,
          `Couldn't load the **${theme.label}** lofi theme right now — try again.`,
        );
        return;
      }
      if (shuffled) tracks = shuffle([...tracks]);
      tracks = tracks.slice(0, MAX_SEED_TRACKS);

      // Replace whatever's queued with the theme's seed batch.
      if (player.queue.tracks.length > 0) await player.queue.splice(0, player.queue.tracks.length);
      await player.queue.add(tracks);

      // Endless WITHOUT a forced loop: enable autoplay so related lofi keeps
      // flowing once the seed runs out. Persist per guild (survives a restart).
      player.set('autoplay', true);
      void setAppSetting(autoplayKey(interaction.guildId!), 'true');

      if (!player.playing && !player.paused) await player.play();
      void refreshPanel(player, true);

      await replyOk(
        interaction,
        `${theme.emoji} **Lofi — ${theme.label}** · queued **${tracks.length}** ` +
          `track${tracks.length === 1 ? '' : 's'}${shuffled ? ' (shuffled)' : ''}; ` +
          'autoplay is on so it never stops. Turn the endless mode off with `/autoplay`.',
      );
    } catch (err) {
      logger.error({ err, guildId: interaction.guildId }, 'lofi start failed');
      await replyError(interaction, 'Something went wrong starting lofi mode.');
    }
  },
};
