import {
  type ChatInputCommandInteraction,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  type VoiceBasedChannel,
} from 'discord.js';
import { getGuildSettings } from '../db/guilds.js';

/**
 * Helpers shared across commands: consistent ephemeral error/ok replies that
 * respect the interaction's reply state (doc §2 "3-second rule"), a voice
 * guard, and the DJ permission check (doc §5).
 */

export async function replyError(
  interaction: ChatInputCommandInteraction,
  message: string,
): Promise<void> {
  const content = `❌ ${message}`;
  if (interaction.deferred) {
    await interaction.editReply({ content });
  } else if (interaction.replied) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
}

export async function replyOk(
  interaction: ChatInputCommandInteraction,
  message: string,
): Promise<void> {
  if (interaction.deferred) {
    await interaction.editReply({ content: message });
  } else if (interaction.replied) {
    await interaction.followUp({ content: message });
  } else {
    await interaction.reply({ content: message });
  }
}

export interface VoiceContext {
  member: GuildMember;
  voiceChannel: VoiceBasedChannel;
}

/**
 * Ensure the invoking member is in a voice channel and — if the bot is already
 * connected — in the *same* channel. Returns null (after replying) on failure.
 */
export async function getVoiceContext(
  interaction: ChatInputCommandInteraction,
): Promise<VoiceContext | null> {
  const member = interaction.member;
  if (!(member instanceof GuildMember) || !interaction.guild) {
    await replyError(interaction, 'This command can only be used in a server.');
    return null;
  }

  const voiceChannel = member.voice.channel;
  if (!voiceChannel) {
    await replyError(interaction, 'You need to be in a voice channel first.');
    return null;
  }

  const botChannelId = interaction.guild.members.me?.voice.channelId;
  if (botChannelId && botChannelId !== voiceChannel.id) {
    await replyError(interaction, "You must be in the bot's voice channel to do that.");
    return null;
  }

  return { member, voiceChannel };
}

/**
 * DJ gate (doc §5). If a DJ role is configured for the guild, only members with
 * that role — or with Manage Server / Administrator — may run gated commands.
 * If no DJ role is set, everyone is allowed.
 */
export async function isDj(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.guild) return false;
  const member = interaction.member;
  if (!(member instanceof GuildMember)) return false;

  if (
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions.has(PermissionFlagsBits.Administrator)
  ) {
    return true;
  }

  const { djRoleId } = await getGuildSettings(interaction.guild.id);
  if (!djRoleId) return true; // no restriction configured
  return member.roles.cache.has(djRoleId);
}
