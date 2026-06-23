import {
  type APIMessageTopLevelComponent,
  type ButtonInteraction,
  ComponentType,
  MessageFlags,
  type StringSelectMenuInteraction,
} from 'discord.js';
import type { Track } from 'lavalink-client';
import type { ElfariaClient } from '../client.js';
import { toggleFavorite } from '../db/favorites.js';
import { getLastPlayed } from '../db/history.js';
import { isDjMember } from '../lib/interactions.js';
import { type LoopState, applyLoop, loopLabel } from '../music/loop.js';
import { ensurePlayer } from '../music/QueueManager.js';
import { refreshPanel } from '../music/player.js';
import { resolve } from '../music/sources.js';

/** Recursively flip a button's `disabled` flag in a message's component JSON. */
interface MutableComponent {
  type: number;
  custom_id?: string;
  disabled?: boolean;
  components?: MutableComponent[];
}
function disableButtonById(components: MutableComponent[], customId: string): boolean {
  let found = false;
  for (const component of components) {
    if (component.type === ComponentType.Button && component.custom_id === customId) {
      component.disabled = true;
      found = true;
    }
    if (component.components) found = disableButtonById(component.components, customId) || found;
  }
  return found;
}

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

  // Replay can run after the queue ended (no player yet), so handle it before the
  // "nothing is playing" guard — it re-creates and reconnects the player if needed.
  if (action === 'replay') {
    await handleReplay(interaction, client);
    return;
  }

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

  // Favorite is personal — no voice/DJ gate, just needs the current track.
  if (action === 'favorite') {
    const current = player.queue.current;
    if (!current?.info.uri) {
      await reply('❌ Nothing favouritable is playing.');
      return;
    }
    const state = await toggleFavorite(interaction.user.id, {
      title: current.info.title,
      uri: current.info.uri,
      author: current.info.author,
    });
    await reply(
      state === 'added'
        ? `⭐ Saved **${current.info.title}** to your favorites — see \`/favorites\`.`
        : `✖️ Removed **${current.info.title}** from your favorites.`,
    );
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
      else await player.stopPlaying(true, true); // run autoplay if it's enabled
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

/**
 * Replay the most recently played track (customId np:replay, shown on the
 * queue-finished message). Re-resolves it by URL and starts it, recreating the
 * player if the bot already left. Open to anyone in the voice channel.
 */
async function handleReplay(
  interaction: ButtonInteraction<'cached'>,
  client: ElfariaClient,
): Promise<void> {
  const voiceChannelId = interaction.member.voice.channelId;
  if (!voiceChannelId) {
    await interaction.reply({ content: '❌ Join a voice channel first.', flags: MessageFlags.Ephemeral });
    return;
  }

  const last = await getLastPlayed(interaction.guildId);
  if (!last) {
    await interaction.reply({
      content: '❌ Nothing has played recently to replay.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const player = await ensurePlayer(
      client,
      interaction.guildId,
      voiceChannelId,
      interaction.channelId,
    );
    const result = await resolve(player, last.uri, interaction.user);
    if (!result.tracks.length) {
      await interaction.editReply(`❌ Couldn't reload **${last.title}**.`);
      return;
    }
    player.queue.add(result.tracks[0]!);
    if (!player.playing && !player.paused) await player.play();
    await interaction.editReply(`↩️ Replaying **${last.title}**.`);

    // One-time: grey out the Replay button on the message it was clicked from,
    // reusing the message's existing component tree (works for V1 and V2 alike).
    const components = interaction.message.components.map((c) => c.toJSON());
    if (disableButtonById(components as unknown as MutableComponent[], 'np:replay')) {
      await interaction.message
        .edit({
          flags: interaction.message.flags.has(MessageFlags.IsComponentsV2)
            ? MessageFlags.IsComponentsV2
            : undefined,
          components: components as APIMessageTopLevelComponent[],
        })
        .catch(() => undefined);
    }
  } catch {
    await interaction.editReply('❌ Something went wrong replaying that.');
  }
}

/**
 * Now-playing dropdowns (customId np:loop and np:volume). DJ-gated and require
 * being in the bot's voice channel, mirroring /loop and /volume, and refresh the
 * card immediately.
 */
export async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  if (interaction.customId !== 'np:loop' && interaction.customId !== 'np:volume') return;
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

  const member = interaction.member;
  if (member.voice.channelId !== player.voiceChannelId) {
    await reply("❌ You must be in the bot's voice channel to do that.");
    return;
  }
  if (!(await isDjMember(interaction.guildId, member))) {
    await reply('❌ You need the DJ role to do that.');
    return;
  }

  if (interaction.customId === 'np:loop') {
    const mode = (interaction.values[0] ?? 'off') as LoopState;
    await applyLoop(player, mode);
    await reply(mode === 'off' ? '➡️ Loop off.' : `🔁 ${loopLabel(mode)}.`);
  } else {
    const level = Number.parseInt(interaction.values[0] ?? '', 10);
    if (Number.isNaN(level)) {
      await reply('❌ Invalid volume.');
      return;
    }
    // Live-only: the panel adjusts THIS session's volume but does NOT change the
    // saved guild default, so the bot returns to the default next time it joins.
    // (Use /volume to set the persistent default.)
    await player.setVolume(level);
    await reply(`🔊 Volume set to **${level}%** for now.`);
  }
  void refreshPanel(player, true);
}
