import { type ButtonInteraction, MessageFlags } from 'discord.js';
import type { Track } from 'lavalink-client';
import type { ElfariaClient } from '../client.js';
import { isDjMember } from '../lib/interactions.js';

/**
 * Now-playing button panel (doc roadmap). Buttons are attached to the
 * trackStart announcement (music/player.ts) with `np:<action>` custom ids; this
 * handler applies the action with the same voice/DJ guards as the slash
 * commands. Replies are ephemeral so the channel isn't spammed.
 */
export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.customId.startsWith('np:')) return;
  const action = interaction.customId.slice('np:'.length);
  const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  if (!interaction.inCachedGuild()) {
    await reply('❌ This only works in a server.');
    return;
  }

  const client = interaction.client as ElfariaClient;
  const player = client.lavalink.getPlayer(interaction.guildId);
  if (!player) {
    await reply('❌ Nothing is playing.');
    return;
  }

  // Queue view is read-only — no voice/DJ checks needed.
  if (action === 'queue') {
    const tracks = player.queue.tracks as Track[];
    const current = player.queue.current;
    const lines = tracks.slice(0, 10).map((t, i) => `\`${i + 1}.\` ${t.info.title}`);
    const body = [
      current ? `**Now playing:** ${current.info.title}` : '',
      lines.length ? lines.join('\n') : '*No upcoming tracks.*',
    ]
      .filter(Boolean)
      .join('\n');
    await reply(body);
    return;
  }

  // All controls require being in the bot's voice channel.
  const member = interaction.member;
  if (member.voice.channelId !== player.voiceChannelId) {
    await reply("❌ You must be in the bot's voice channel to do that.");
    return;
  }

  // Pause/resume is open to any listener in the channel.
  if (action === 'playpause') {
    if (player.paused) {
      await player.resume();
      await reply('▶️ Resumed.');
    } else {
      await player.pause();
      await reply('⏸️ Paused.');
    }
    return;
  }

  // skip / stop / shuffle are DJ-gated (same as the slash commands).
  if (!(await isDjMember(interaction.guildId, member))) {
    await reply('❌ You need the DJ role to do that.');
    return;
  }

  switch (action) {
    case 'skip':
      if (!player.queue.current) {
        await reply('❌ Nothing is playing.');
        return;
      }
      if (player.queue.tracks.length > 0) await player.skip();
      else await player.stopPlaying();
      await reply('⏭️ Skipped.');
      return;
    case 'stop':
      await player.destroy('Stopped by user');
      await reply('⏹️ Stopped and cleared the queue.');
      return;
    case 'shuffle':
      if (player.queue.tracks.length < 2) {
        await reply('❌ Not enough tracks to shuffle.');
        return;
      }
      await player.queue.shuffle();
      await reply('🔀 Shuffled.');
      return;
    default:
      await reply('❌ Unknown control.');
  }
}
