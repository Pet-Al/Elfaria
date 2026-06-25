import type { Player } from 'lavalink-client';
import { config } from '../config.js';

/**
 * Now-playing card update pipeline.
 *
 * One process-wide loop owns every card edit, decoupled from command handling.
 * Commands and playback events never edit a card directly — they MARK the player
 * dirty (cheap, synchronous) and return. A single drain then coalesces bursts to
 * at most one edit per player per tick, so a flood of commands can neither stall
 * nor spam the live progress-timer / synced-lyrics updates. The timer cadence
 * and the burst throttle both derive from NOWPLAYING_REFRESH_MS — there is no
 * hidden hardcoded cap (the old 3s floor is gone).
 */

type Renderer = (player: Player) => Promise<void>;
type PlayersProvider = () => Iterable<Player>;

const REFRESH_MS = config.music.nowPlayingRefreshMs;
/**
 * Never edit a given card faster than this. Just under one tick, so a scheduled
 * tick is never throttled away, while command-driven marks between ticks still
 * coalesce into the next tick's single edit.
 */
const MIN_EDIT_INTERVAL_MS = REFRESH_MS > 0 ? Math.max(500, Math.floor(REFRESH_MS * 0.9)) : 0;

const dirty = new Map<string, Player>(); // guildId -> latest player ref to render
const lastEdit = new Map<string, number>(); // guildId -> last edit dispatch time
let renderer: Renderer | null = null;
let provider: PlayersProvider | null = null;
let loop: NodeJS.Timeout | null = null;

/** Request a coalesced card refresh for a player (performed by the drain loop). */
export function markPanelDirty(player: Player): void {
  dirty.set(player.guildId, player);
}

/** Drop any pending/throttle state for a guild (e.g. its player was destroyed). */
export function clearPanelDirty(guildId: string): void {
  dirty.delete(guildId);
  lastEdit.delete(guildId);
}

/**
 * Start the single update loop. `render` performs one card edit; `players` yields
 * the currently-active players to tick on the timer cadence. No-op when live
 * updates are disabled (NOWPLAYING_REFRESH_MS=0) or the loop is already running.
 */
export function startPanelScheduler(render: Renderer, players: PlayersProvider): void {
  renderer = render;
  provider = players;
  if (loop || REFRESH_MS <= 0) return;
  loop = setInterval(() => void tick(), REFRESH_MS);
  loop.unref?.(); // don't keep the process alive just for the ticker
}

function tick(): void {
  if (!renderer) return;

  // 1) Timer cadence — mark every actively-playing card dirty so the progress
  //    bar and lyric line advance even with zero command activity.
  if (provider) {
    for (const player of provider()) {
      if (player.playing && !player.paused && player.get('npMessage')) markPanelDirty(player);
    }
  }

  // 2) Drain — one edit per dirty player, throttled. Edits are fire-and-forget
  //    (discord.js owns the REST rate-limit queue), so a slow edit never blocks
  //    the loop or other guilds. A player throttled this tick is re-deferred.
  if (dirty.size === 0) return;
  const now = Date.now();
  const batch = [...dirty.values()];
  dirty.clear();
  for (const player of batch) {
    const last = lastEdit.get(player.guildId) ?? 0;
    if (now - last < MIN_EDIT_INTERVAL_MS) {
      dirty.set(player.guildId, player); // try again next tick
      continue;
    }
    lastEdit.set(player.guildId, now);
    void renderer(player);
  }
}
