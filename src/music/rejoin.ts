import type { ElfariaClient } from '../client.js';
import {
  deleteAppSetting,
  getAppSetting,
  listAppSettingsByPrefix,
  setAppSetting,
} from '../db/appSettings.js';
import { logger } from '../lib/logger.js';
import { ensurePlayer } from './QueueManager.js';
import { resolve } from './sources.js';

/**
 * 24/7 persistence + auto-rejoin (the honest gap from before). When 24/7 is
 * enabled we remember the guild's voice + text channel (and a lofi station, if
 * one is running) so that after a full restart the bot REJOINS voice on boot and
 * resumes — instead of you having to re-summon it. Cleared when 24/7 is turned
 * off. Per-guild, in the shared DB, so only the pod that owns the guild acts.
 */

const PREFIX = '247state:';
const key = (guildId: string) => `${PREFIX}${guildId}`;

interface State {
  /** voice channel id */ v: string;
  /** text channel id */ t: string;
  /** forever (ignore empty-channel leave) */ forever: boolean;
  /** lofi station id to resume, if a lofi stream was running */ lofi?: string;
}

export async function persist247State(
  guildId: string,
  state: { voiceChannelId: string; textChannelId: string; forever: boolean },
): Promise<void> {
  const existing = await read(guildId);
  const next: State = {
    v: state.voiceChannelId,
    t: state.textChannelId,
    forever: state.forever,
    ...(existing?.lofi ? { lofi: existing.lofi } : {}),
  };
  await setAppSetting(key(guildId), JSON.stringify(next)).catch(() => undefined);
}

/** Record (or clear) the lofi station on an existing 24/7 state, so it resumes. */
export async function set247Lofi(guildId: string, lofiStationId: string | null): Promise<void> {
  const existing = await read(guildId);
  if (!existing) return; // only meaningful when 24/7 is on
  if (lofiStationId) existing.lofi = lofiStationId;
  else delete existing.lofi;
  await setAppSetting(key(guildId), JSON.stringify(existing)).catch(() => undefined);
}

export async function clear247State(guildId: string): Promise<void> {
  await deleteAppSetting(key(guildId)).catch(() => undefined);
}

async function read(guildId: string): Promise<State | undefined> {
  const raw = await getAppSetting(key(guildId)).catch(() => undefined);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as State;
  } catch {
    return undefined;
  }
}

/** Wait (briefly) for at least one Lavalink node to connect before rejoining. */
async function waitForNode(client: ElfariaClient, timeoutMs = 20_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ([...client.lavalink.nodeManager.nodes.values()].some((n) => n.connected)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/**
 * On boot: rejoin every guild that had 24/7 on (and that THIS process owns), and
 * resume its lofi stream if one was running. Best-effort and per-guild fail-soft.
 */
export async function autoRejoin247(client: ElfariaClient): Promise<void> {
  const states = await listAppSettingsByPrefix(PREFIX).catch(() => []);
  if (states.length === 0) return;
  if (!(await waitForNode(client))) {
    logger.warn('24/7 auto-rejoin skipped — no Lavalink node connected in time');
    return;
  }

  let rejoined = 0;
  for (const { key: stateKey, value } of states) {
    const guildId = stateKey.slice(PREFIX.length);
    if (!client.guilds.cache.has(guildId)) continue; // another shard/pod owns it

    let state: State;
    try {
      state = JSON.parse(value) as State;
    } catch {
      await clear247State(guildId);
      continue;
    }

    try {
      const player = await ensurePlayer(client, guildId, state.v, state.t);
      player.set('247', true);
      player.set('247Forever', state.forever);

      // Restore the persisted queue (session migration) before falling back.
      await player.queue.utils.sync().catch(() => undefined);
      const hasQueue = !!player.queue.current || player.queue.tracks.length > 0;

      if (hasQueue) {
        if (!player.playing && !player.paused) await player.play().catch(() => undefined);
      } else if (state.lofi && client.user) {
        const result = await resolve(
          player,
          `https://www.youtube.com/watch?v=${state.lofi}`,
          client.user,
        );
        const track = result.tracks[0];
        if (track) await player.play({ clientTrack: track });
      }
      rejoined += 1;
    } catch (err) {
      logger.warn({ err, guildId }, '24/7 auto-rejoin failed for guild');
    }
  }
  if (rejoined > 0) logger.info({ rejoined }, '24/7 auto-rejoin: reconnected to voice');
}
