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
import { ensurePlayer, formatDuration, skipCurrent } from '../music/QueueManager.js';
import { getCardTrack } from '../music/panelStore.js';
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

  // Replay + favorite can run on a finished/expired card (no player yet), so
  // handle them before the "nothing is playing" guard — they fall back to the
  // last-played track. Replay re-creates and reconnects the player if needed.
  if (action === 'replay') {
    await handleReplay(interaction, client);
    return;
  }
  if (action === 'favorite') {
    await handleFavorite(interaction, client);
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
    case 'back': {
      const previous = await player.queue.shiftPrevious().catch(() => undefined);
      if (!previous) {
        await reply('❌ No previous track to go back to.');
        return;
      }
      // Play the previous track now. We deliberately do NOT re-queue the current
      // track at the front: play() pushes it onto the previous stack anyway (so
      // it's reachable by pressing back again), and re-adding it caused a
      // duplicate when combined with /replay. No double now.
      await player.play({ clientTrack: previous });
      await reply(`⏮️ Playing the previous track — **${previous.info.title}**.`);
      return;
    }
    case 'skip':
      if (!player.queue.current) {
        await reply('❌ Nothing is playing.');
        return;
      }
      await skipCurrent(player); // advances via autoplay when the queue is empty
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
 * Toggle a personal favorite (customId np:favorite). Favorites the track shown on
 * the SPECIFIC card you clicked — looked up by the card's message id — so pressing
 * ⭐ on an older (buried/finished) card saves *that* song, not whatever is playing
 * now. Falls back to the live current track, then the guild's last-played track
 * (e.g. after a restart wiped the in-memory card map). Personal, so no DJ gate.
 */
async function handleFavorite(
  interaction: ButtonInteraction<'cached'>,
  client: ElfariaClient,
): Promise<void> {
  const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  // The card you clicked wins. Only if we don't know it (restart) do we fall
  // back to the live track, then the guild's last-played.
  const mapped = getCardTrack(interaction.message.id);
  const current = client.lavalink.getPlayer(interaction.guildId)?.queue.current;
  const track =
    mapped ??
    (current?.info.uri != null
      ? { title: current.info.title, uri: current.info.uri, author: current.info.author }
      : await getLastPlayed(interaction.guildId));

  if (!track?.uri) {
    await reply('❌ Nothing to favourite.');
    return;
  }
  const state = await toggleFavorite(interaction.user.id, track);
  await reply(
    state === 'added'
      ? `⭐ Saved **${track.title}** to your favorites — see \`/favorites\`.`
      : `✖️ Removed **${track.title}** from your favorites.`,
  );
}

/**
 * Replay the track shown on the card you clicked (customId np:replay). Looks the
 * track up by the card's message id so replaying an OLDER card brings back THAT
 * song — falling back to the guild's last-played track when the card map was
 * wiped (a restart). Re-resolves by URL and starts it, recreating the player if
 * the bot already left. Open to anyone in the voice channel.
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

  const last = getCardTrack(interaction.message.id) ?? (await getLastPlayed(interaction.guildId));
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

/** Now-playing dropdown custom ids handled here. */
const NP_SELECTS = new Set(['np:loop', 'np:volume', 'np:seek']);

/**
 * Now-playing dropdowns (customId np:loop, np:volume, np:seek). DJ-gated and
 * require being in the bot's voice channel, mirroring /loop, /volume and /seek,
 * and refresh the card immediately.
 */
export async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!NP_SELECTS.has(interaction.customId)) return;
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
  } else if (interaction.customId === 'np:volume') {
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
  } else {
    // np:seek — jump to the chosen offset (ms). Streams/unseekable tracks have no
    // dropdown, but guard anyway and clamp to the track's duration.
    const current = player.queue.current;
    const position = Number.parseInt(interaction.values[0] ?? '', 10);
    if (Number.isNaN(position) || !current || current.info.isStream || !current.info.duration) {
      await reply("❌ This track can't be seeked.");
      return;
    }
    const target = Math.max(0, Math.min(position, current.info.duration - 1));
    try {
      await player.seek(target);
    } catch {
      await reply("❌ This track can't be seeked.");
      return;
    }
    await reply(`⏩ Jumped to **${formatDuration(target)}**.`);
  }
  void refreshPanel(player, true);
}
