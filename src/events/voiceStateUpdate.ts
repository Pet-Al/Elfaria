import { Events } from 'discord.js';
import type { ElfariaClient } from '../client.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import type { BotEvent } from '../lib/types.js';

/**
 * Empty-channel auto-leave (doc §10).
 *
 * Lavalink handles leaving after the queue ends (onEmptyQueue.destroyAfterMs);
 * this covers the other case — everyone leaves the voice channel while a track
 * is still playing. We wait `leaveOnEmptyMs` (cancelled if someone rejoins) so a
 * brief disconnect doesn't kill playback, then destroy the player.
 */
const leaveTimers = new Map<string, NodeJS.Timeout>();

function humansIn(client: ElfariaClient, guildId: string, channelId: string): number {
  const channel = client.guilds.cache.get(guildId)?.channels.cache.get(channelId);
  return channel?.isVoiceBased() ? channel.members.filter((m) => !m.user.bot).size : 0;
}

export const voiceStateUpdate: BotEvent<Events.VoiceStateUpdate> = {
  name: Events.VoiceStateUpdate,
  execute(oldState, newState) {
    const guild = newState.guild;
    const client = guild.client as ElfariaClient;
    const player = client.lavalink.getPlayer(guild.id);
    if (!player?.voiceChannelId) return;

    // Only react to changes that touched the bot's own channel.
    if (
      oldState.channelId !== player.voiceChannelId &&
      newState.channelId !== player.voiceChannelId
    ) {
      return;
    }

    const existing = leaveTimers.get(guild.id);

    if (humansIn(client, guild.id, player.voiceChannelId) > 0) {
      if (existing) {
        clearTimeout(existing);
        leaveTimers.delete(guild.id);
      }
      return;
    }

    if (existing) return; // a leave is already scheduled

    const timer = setTimeout(() => {
      leaveTimers.delete(guild.id);
      const current = client.lavalink.getPlayer(guild.id);
      // `/24-7 mode:forever` opts out of the empty-channel leave entirely.
      if (current?.get<boolean>('247Forever')) return;
      if (current?.voiceChannelId && humansIn(client, guild.id, current.voiceChannelId) === 0) {
        logger.info({ guildId: guild.id }, 'voice channel empty — leaving');
        void current.destroy('Channel empty');
      }
    }, config.music.leaveOnEmptyMs);

    leaveTimers.set(guild.id, timer);
  },
};
