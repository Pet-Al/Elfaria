import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { cachedAccentColor } from '../lib/artwork.js';
import { replyError } from '../lib/interactions.js';
import type { Command } from '../lib/types.js';
import { loopStateOf } from '../music/loop.js';
import { getPlayer } from '../music/QueueManager.js';
import { nowPlayingCard } from '../music/nowPlayingCard.js';

export const nowplaying: Command = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Show the track currently playing.'),
  async execute(interaction) {
    const player = getPlayer(interaction);
    if (!player?.queue.current) {
      await replyError(interaction, 'Nothing is playing.');
      return;
    }

    const track = player.queue.current;

    // A live snapshot of the now-playing card — no buttons, since the persistent
    // control panel already lives on the auto-posted message.
    await interaction.reply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        nowPlayingCard(track, {
          positionMs: player.position,
          withControls: false,
          accentColor: cachedAccentColor(track.info.artworkUrl),
          volume: player.volume,
          loopState: loopStateOf(player),
          upNext: player.queue.tracks.slice(0, 3).map((t) => t.info?.title ?? 'Unknown'),
          queueLength: player.queue.tracks.length,
        }),
      ],
    });
  },
};
