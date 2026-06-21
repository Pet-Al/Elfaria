import { getVoiceConnection } from 'discord-player';
import { Events } from 'discord.js';
import { logger } from '../lib/logger.js';
import type { BotEvent } from '../lib/types.js';
import { getQueue } from '../music/QueueManager.js';

/**
 * Empty-channel auto-leave safeguard (doc §10).
 *
 * discord-player already leaves on empty while a queue is active (configured in
 * QueueManager.buildNodeOptions). This event is the backstop for the desync
 * case: the bot is sitting in a now-empty channel with no active queue. We free
 * the voice connection so we don't hold resources in a channel nobody's in.
 */
export const voiceStateUpdate: BotEvent<Events.VoiceStateUpdate> = {
  name: Events.VoiceStateUpdate,
  execute(oldState, newState) {
    const guild = newState.guild;
    const botChannelId = guild.members.me?.voice.channelId;
    if (!botChannelId) return;

    // Only react to changes that touched the bot's own channel.
    if (oldState.channelId !== botChannelId && newState.channelId !== botChannelId) return;

    const channel = guild.channels.cache.get(botChannelId);
    if (!channel?.isVoiceBased()) return;

    const humans = channel.members.filter((m) => !m.user.bot).size;
    if (humans > 0) return;

    // A live queue means discord-player owns the leave timer; don't interfere.
    if (getQueue(guild.id)) return;

    const connection = getVoiceConnection(guild.id);
    if (connection) {
      logger.info(
        { guildId: guild.id },
        'voice channel empty with no active queue — disconnecting',
      );
      connection.destroy();
    }
  },
};
