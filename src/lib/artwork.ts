import { logger } from './logger.js';

/**
 * Album-art accent colour (doc roadmap, "accent color from album art").
 *
 * Fetches the track artwork and averages it down to a single RGB value (via
 * sharp resize-to-1x1) so the now-playing card's accent bar matches the cover.
 * Entirely fail-soft: sharp is an OPTIONAL dependency and the fetch is bounded,
 * so any problem (no sharp, network, decode) falls back to the brand colour.
 * Results are cached by URL so we extract once per cover, not once per panel.
 */

const DEFAULT_ACCENT = 0x5865f2;
const cache = new Map<string, number>();

/** Cached colour only — no fetch. Safe in latency-sensitive paths (slash replies). */
export function cachedAccentColor(url?: string | null): number {
  return (url && cache.get(url)) || DEFAULT_ACCENT;
}

/** Extract (and cache) the accent colour for an artwork URL. Never throws. */
export async function getAccentColor(url?: string | null): Promise<number> {
  if (!url) return DEFAULT_ACCENT;
  const cached = cache.get(url);
  if (cached !== undefined) return cached;

  let color = DEFAULT_ACCENT;
  try {
    const sharp = (await import('sharp')).default;
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      const input = Buffer.from(await res.arrayBuffer());
      const { data } = await sharp(input)
        .resize(1, 1, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      color = ((data[0] ?? 0) << 16) | ((data[1] ?? 0) << 8) | (data[2] ?? 0);
    }
  } catch (err) {
    logger.debug({ err }, 'accent colour extraction failed; using default');
  }

  // Keep the cache from growing unbounded over a long uptime.
  if (cache.size > 500) cache.clear();
  cache.set(url, color);
  return color;
}
