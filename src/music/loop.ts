import type { Player } from 'lavalink-client';

/**
 * Loop modes (doc roadmap). Lavalink's repeat is only off/track/queue, so the
 * "once" variants are layered on top: we arm a one-shot marker (the identifier
 * of the track that was playing when looping was set) and, when we return to it,
 * turn looping off — giving exactly one extra play (track-once) or one extra lap
 * (queue-once).
 */
export type LoopState = 'off' | 'track-once' | 'track' | 'queue-once' | 'queue';

const CYCLE: LoopState[] = ['off', 'track-once', 'track', 'queue-once', 'queue'];

interface LoopMarker {
  identifier: string;
}

/** The current loop state, derived from the repeat mode + one-shot marker. */
export function loopStateOf(player: Player): LoopState {
  const once = player.get<LoopMarker | undefined>('loopOnce');
  if (player.repeatMode === 'track') return once ? 'track-once' : 'track';
  if (player.repeatMode === 'queue') return once ? 'queue-once' : 'queue';
  return 'off';
}

/** Apply a loop state: set Lavalink's repeat mode and arm/clear the one-shot marker. */
export async function applyLoop(player: Player, state: LoopState): Promise<void> {
  const id = player.queue.current?.info.identifier;
  const marker: LoopMarker | undefined = id ? { identifier: id } : undefined;

  switch (state) {
    case 'off':
      await player.setRepeatMode('off');
      player.set('loopOnce', undefined);
      return;
    case 'track':
      await player.setRepeatMode('track');
      player.set('loopOnce', undefined);
      return;
    case 'queue':
      await player.setRepeatMode('queue');
      player.set('loopOnce', undefined);
      return;
    case 'track-once':
      await player.setRepeatMode('track');
      player.set('loopOnce', marker);
      return;
    case 'queue-once':
      await player.setRepeatMode('queue');
      player.set('loopOnce', marker);
      return;
  }
}

/** Advance to the next state in the cycle (off→track×1→track∞→queue×1→queue∞). */
export async function cycleLoop(player: Player): Promise<LoopState> {
  const next = CYCLE[(CYCLE.indexOf(loopStateOf(player)) + 1) % CYCLE.length]!;
  await applyLoop(player, next);
  return next;
}

/**
 * Called on each track start: if a one-shot loop is armed and we've returned to
 * the marked track (the repeat for track-once, or the start of the next lap for
 * queue-once), disarm it so playback continues exactly once more then stops.
 */
export async function settleLoopOnce(player: Player, identifier?: string): Promise<void> {
  const once = player.get<LoopMarker | undefined>('loopOnce');
  if (once && identifier && once.identifier === identifier) {
    await player.setRepeatMode('off');
    player.set('loopOnce', undefined);
  }
}

/** Human label for a loop state. */
export function loopLabel(state: LoopState): string {
  switch (state) {
    case 'track-once':
      return 'Loop: track ×1';
    case 'track':
      return 'Loop: track ∞';
    case 'queue-once':
      return 'Loop: queue ×1';
    case 'queue':
      return 'Loop: queue ∞';
    default:
      return 'off';
  }
}
