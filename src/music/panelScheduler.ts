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
 *
 * ── Concurrency model (why live updates + commands run alongside) ─────────────
 * Node is single-threaded for JS, but this whole workload is I/O-bound (Discord
 * REST, Lavalink, the DB) — so the event loop already gives us concurrency for
 * free, and multithreading/worker_threads would add complexity without helping
 * (the bottleneck is the network + Discord's rate limits, not CPU). The design
 * leans into that:
 *   • `markPanelDirty` is a synchronous Map.set — a command marks its card and
 *     returns in microseconds; it NEVER awaits a render. So /skip, /volume, etc.
 *     stay snappy no matter how many cards are ticking.
 *   • The actual `message.edit`s are dispatched fire-and-forget from the timer
 *     tick, so a slow edit yields to the event loop and command handlers (each
 *     in its own async call) interleave freely.
 *   • Card edits (a channel-message route) and command replies (an interaction-
 *     webhook route) sit in different discord.js REST buckets, so they don't
 *     queue behind each other.
 * The live behaviour is intentionally unchanged — same cadence, same coalescing;
 * the only addition is a defensive render timeout so a hung edit can't freeze a
 * card forever (see RENDER_TIMEOUT_MS).
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
/**
 * Safety net for the per-player in-flight guard: if a `message.edit` somehow
 * neither resolves nor rejects (a wedged socket past discord.js's own timeout),
 * release the guard after this long so the card resumes ticking instead of
 * freezing forever. Set well above a normal edit so the happy path never trips it
 * (and so we never run two real edits at once — the multi-skip glitch we fixed).
 */
const RENDER_TIMEOUT_MS = Math.max(10_000, REFRESH_MS * 5);

const dirty = new Map<string, Player>(); // guildId -> latest player ref to render
const lastEdit = new Map<string, number>(); // guildId -> last edit dispatch time
const inFlight = new Set<string>(); // guildIds whose edit hasn't resolved yet
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
  inFlight.delete(guildId);
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

  // 2) Drain — one edit per dirty player, throttled AND serialized per player.
  //    Edits are fire-and-forget across DIFFERENT guilds (discord.js owns the
  //    REST rate-limit queue), but for a SINGLE player we never start a new edit
  //    while its previous one is still in flight — two concurrent message.edits
  //    can land out of order and make the progress bar jump backwards (the
  //    "multi-skip glitches the timer" bug). A player skipped this tick is
  //    re-deferred to the next.
  if (dirty.size === 0) return;
  const now = Date.now();
  const batch = [...dirty.values()];
  dirty.clear();
  for (const player of batch) {
    const gid = player.guildId;
    if (inFlight.has(gid)) {
      dirty.set(gid, player); // previous edit still running — try next tick
      continue;
    }
    const last = lastEdit.get(gid) ?? 0;
    if (now - last < MIN_EDIT_INTERVAL_MS) {
      dirty.set(gid, player); // throttled — try next tick
      continue;
    }
    lastEdit.set(gid, now);
    inFlight.add(gid);
    // Release the in-flight guard exactly once — whichever comes first, the edit
    // settling or the safety timeout — so a wedged request can't strand the card.
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      inFlight.delete(gid);
    };
    const guard = setTimeout(release, RENDER_TIMEOUT_MS);
    guard.unref?.();
    void renderer(player).finally(() => {
      clearTimeout(guard);
      release();
    });
  }
}
