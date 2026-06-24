import { createHash } from 'node:crypto';
import { recordEvent } from './events.js';

/**
 * A/B experimentation on the event pipeline (doc roadmap, "experimentation").
 *
 * Deterministic, stateless bucketing: a unit (guild id, user id) is hashed with
 * the experiment name and mapped to a variant, so the SAME unit always lands in
 * the SAME variant without storing assignments. An `exposure` event is logged
 * when a unit is shown a variant; combined with the existing play/skip events
 * you can compare outcomes per variant (see the analysis query in docs/DATA.md).
 *
 * This is the substrate for testing changes safely — e.g. recommender ordering
 * (trained-first vs co-play-first) is wired into autoplay.
 */

export type Variant = string;

/** Deterministically bucket `unit` into one of `variants` for `experiment`. */
export function assignVariant(
  experiment: string,
  unit: string,
  variants: Variant[] = ['control', 'treatment'],
): Variant {
  if (variants.length === 0) return 'control';
  const hash = createHash('sha256').update(`${experiment}:${unit}`).digest();
  return variants[hash.readUInt32BE(0) % variants.length]!;
}

/** Log that `unit` (guild/user) was shown `variant` of `experiment`. */
export function recordExposure(
  experiment: string,
  variant: Variant,
  ctx: { guildId?: string | null; userId?: string | null },
): void {
  recordEvent({
    type: 'exposure',
    guildId: ctx.guildId,
    userId: ctx.userId,
    query: `${experiment}=${variant}`,
  });
}
