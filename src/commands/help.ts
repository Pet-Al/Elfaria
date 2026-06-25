import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../lib/types.js';

/**
 * /help — a grouped reference for Elfaria's commands. Kept as a curated layout
 * (not an auto-dump of the registry) so related commands read together and the
 * now-playing buttons are explained alongside.
 */
const GROUPS: { name: string; lines: string[] }[] = [
  {
    name: '▶️ Playback',
    lines: [
      '`/play` — play a track/playlist or search (with autocomplete)',
      '`/pause` `/resume` `/skip` `/stop` — transport',
      '`/seek` `/skipto` — jump within / to a track',
      '`/nowplaying` — show the live card · `/lyrics` — current lyrics',
      '`/replay` — replay the last track or pick one from history',
    ],
  },
  {
    name: '📜 Queue',
    lines: [
      '`/queue` — view the queue (paged) · `/clear` — empty it',
      '`/move` `/remove` `/shuffle` — reorder / trim / shuffle',
      '`/loop` — track/queue loop · `/autoplay` — keep going when it ends',
      '`/recommend` — queue picks made for you · `/reroll` — fresh autoplay picks',
      '`/autoplay-dequeue` — drop the autoplay picks',
    ],
  },
  {
    name: '🎛️ Modes & sound',
    lines: [
      '`/lofi` — pick a lofi **theme** (chill/study/sleep/jazz/…) · `/24-7` — stay in voice (until-empty/forever)',
      '`/filter` — EQ / effects incl. **vocal** clarity (add `save:true` for a server default)',
      '`/sponsorblock` — skip sponsor/intro/off-topic segments · `/volume` — set the volume',
      '`/modifiers` — see what’s active (autoplay/filter/…) + toggle persistence',
    ],
  },
  {
    name: '📚 Library & server',
    lines: [
      '`/favorites` — your saved tracks (type to search in `play`) · `/history` — recently played (paged)',
      '`/replay` `[position]` — replay a track from history (default: most recent)',
      '`/playlist` — save / load playlists · `/summon` — move the bot to your VC',
      '`/settings` — DJ role & default volume · `/status` — health · `/about` — the tech stack',
    ],
  },
  {
    name: '🔒 Privacy',
    lines: ['`/forget-me` — delete the data Elfaria stores about you'],
  },
];

const BUTTONS =
  '**Now-playing buttons:** ⏮️ back · ⏯️ play/pause · ⏭️ skip · ⏹️ stop · 📜 queue · ' +
  '⭐ favorite · 🔀 shuffle · ↩️ replay · plus loop / volume / seek dropdowns. ' +
  '↩️ Replay restarts the current song from the top; on an older/finished card it ' +
  're-queues that track. Favorite/Replay always target the song on the card you ' +
  'click (even an old one), and finished cards keep their buttons for ~30 min.';

export const help: Command = {
  data: new SlashCommandBuilder().setName('help').setDescription('List Elfaria’s commands.'),
  cooldownMs: 0,
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎶 Elfaria — command guide')
      .setDescription(BUTTONS)
      .setFooter({ text: 'Tip: most controls also live on the now-playing card.' });
    for (const group of GROUPS) {
      embed.addFields({ name: group.name, value: group.lines.join('\n') });
    }
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
