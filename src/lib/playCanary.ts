import type { ElfariaClient } from '../client.js';
import { config } from '../config.js';
import { ensurePlayer } from '../music/QueueManager.js';
import { resolve } from '../music/sources.js';
import { logger } from './logger.js';
import { playCanarySuccess } from './metrics.js';

/**
 * End-to-end PLAY canary (doc roadmap). The source-resolve probe proves Lavalink
 * can *find* a track; this proves it can actually *play* one. Opt-in (needs a
 * DEDICATED staging guild + empty voice channel, configured via CANARY_*): the
 * bot joins, plays a known track, checks the player position genuinely ADVANCES
 * (audio only streams when it does), then leaves. Exports
 * `elfaria_play_canary_success` (1/0). It will interrupt playback in its target
 * channel, so it must point at a throwaway VC — never a real one.
 */
const INTERVAL_MS = 15 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60_000;
const SETTLE_MS = 8_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runOnce(client: ElfariaClient): Promise<void> {
  const { guildId, voiceChannelId, textChannelId, query } = config.canary;
  // Only the shard/pod that owns the canary guild can join its voice channel.
  if (!client.guilds.cache.has(guildId) || !client.user) return;

  let player;
  try {
    player = await ensurePlayer(client, guildId, voiceChannelId, textChannelId || voiceChannelId);
    const result = await resolve(player, query, client.user);
    const track = result.tracks[0];
    if (!track) {
      playCanarySuccess.set(0);
      logger.warn('play canary: nothing resolved');
      return;
    }
    await player.play({ clientTrack: track });
    await sleep(SETTLE_MS);

    // Audio is genuinely flowing only if the player is playing AND its position
    // has moved past the start within the settle window.
    const streaming = player.playing && player.position > 1000;
    playCanarySuccess.set(streaming ? 1 : 0);
    if (!streaming) {
      logger.warn(
        { playing: player.playing, position: player.position },
        'play canary: position did not advance — playback may be broken',
      );
    }
  } catch (err) {
    playCanarySuccess.set(0);
    logger.warn({ err }, 'play canary failed');
  } finally {
    // Leave the canary channel so it isn't sitting idle until the next run.
    await player?.destroy('play canary done').catch(() => undefined);
  }
}

/** Start the periodic play canary (no-op unless CANARY_GUILD_ID + channel are set). */
export function startPlayCanary(client: ElfariaClient): void {
  if (!config.canary.guildId || !config.canary.voiceChannelId) return;
  if (!config.metrics.enabled) return; // feeds metrics
  setTimeout(() => void runOnce(client), FIRST_RUN_DELAY_MS).unref?.();
  setInterval(() => void runOnce(client), INTERVAL_MS).unref?.();
  logger.info(
    { guildId: config.canary.guildId },
    'end-to-end play canary scheduled (joins a staging VC to verify real audio)',
  );
}
