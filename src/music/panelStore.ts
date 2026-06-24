import {
  type APIMessageTopLevelComponent,
  type Client,
  ComponentType,
  type Message,
  MessageFlags,
} from 'discord.js';
import {
  deleteAppSetting,
  listAppSettingsByPrefix,
  setAppSetting,
} from '../db/appSettings.js';
import { getLastPlayed } from '../db/history.js';
import { logger } from '../lib/logger.js';
import { cachedAccentColor } from '../lib/artwork.js';
import { nowPlayingCard } from './nowPlayingCard.js';
import type { Track } from 'lavalink-client';

/**
 * Now-playing panel persistence so a panel doesn't stay "live" after the bot
 * dies (doc: the panel should expire if the bot crashes/restarts or is kicked).
 *
 * On a clean leave/queue-end the panel is already transformed into a greyed
 * card whose Replay/Favorite still work, and we DROP the saved ref. So the only
 * refs that survive a restart belong to LIVE panels from a process that didn't
 * shut down cleanly (a crash/OOM/kill). On boot we find those and retire them.
 */

const PREFIX = 'panel:';
const key = (guildId: string) => `${PREFIX}${guildId}`;

/** Remember the live panel for a guild (channelId:messageId). Fail-soft. */
export async function rememberPanel(
  guildId: string,
  channelId: string,
  messageId: string,
): Promise<void> {
  await setAppSetting(key(guildId), `${channelId}:${messageId}`).catch(() => undefined);
}

/** Forget a guild's panel ref (called once the panel becomes a final/greyed card). */
export async function forgetPanel(guildId: string): Promise<void> {
  await deleteAppSetting(key(guildId)).catch(() => undefined);
}

// ── Per-card track memory (so Favorite targets the card you clicked) ──────────
// Every now-playing card — live, buried, or finished — represents ONE specific
// track. Without this map, the Favorite button on an old card would save
// whatever is playing *now* (the reported bug), because the handler only knew
// the live `current`. Keyed by MESSAGE id; in-memory (a restart falls back to
// the guild's last-played track). Bounded with FIFO eviction.
export interface CardTrack {
  title: string;
  uri: string;
  author?: string;
}
const CARD_TRACK_LIMIT = 1000;
const cardTracks = new Map<string, CardTrack>();

/** Record which track a given card message shows (for its Favorite button). */
export function rememberCardTrack(messageId: string, track: CardTrack): void {
  cardTracks.delete(messageId); // re-insert so it counts as most-recent
  cardTracks.set(messageId, track);
  if (cardTracks.size > CARD_TRACK_LIMIT) {
    const oldest = cardTracks.keys().next().value;
    if (oldest !== undefined) cardTracks.delete(oldest);
  }
}

/** The track shown on a given card message, if still remembered. */
export function getCardTrack(messageId: string): CardTrack | undefined {
  return cardTracks.get(messageId);
}

// ── Time-based expiry of a retired card's Replay/Favorite buttons ─────────────
// Keyed by MESSAGE id so every retired card (final, buried, or destroyed) gets
// its own ~30-minute Favorite/Replay window independently.
const EXPIRY_MS = 30 * 60 * 1000;
const expiryTimers = new Map<string, NodeJS.Timeout>();

/** Cancel a message's pending button-expiry (e.g. that message went live again). */
export function clearPanelExpiry(messageId: string): void {
  const timer = expiryTimers.get(messageId);
  if (timer) clearTimeout(timer);
  expiryTimers.delete(messageId);
}

/** Grey out a retired card's remaining buttons after EXPIRY_MS (~30 min). */
export function armPanelExpiry(message: Message): void {
  clearPanelExpiry(message.id);
  const timer = setTimeout(() => {
    expiryTimers.delete(message.id);
    cardTracks.delete(message.id); // its buttons are about to be disabled
    void expireMessage(message);
  }, EXPIRY_MS);
  timer.unref?.(); // don't keep the process alive just for this
  expiryTimers.set(message.id, timer);
}

async function expireMessage(message: Message): Promise<void> {
  try {
    const components = message.components.map((c) => c.toJSON());
    disableAll(components as { type: number; disabled?: boolean; components?: unknown[] }[]);
    await message.edit({
      flags: message.flags.has(MessageFlags.IsComponentsV2) ? MessageFlags.IsComponentsV2 : undefined,
      components: components as APIMessageTopLevelComponent[],
    });
  } catch {
    // message gone / not editable — nothing to do
  }
}

/** Disable every interactive component in a message's component JSON, in place. */
function disableAll(components: { type: number; disabled?: boolean; components?: unknown[] }[]): void {
  for (const component of components) {
    if (component.type === ComponentType.Button || component.type === ComponentType.StringSelect) {
      component.disabled = true;
    }
    if (Array.isArray(component.components)) {
      disableAll(component.components as typeof components);
    }
  }
}

/**
 * Retire any panels left live by a previous (crashed) process. For each saved
 * ref, edit the message into a finished card (greyed transport, but Replay +
 * Favorite still work) using the guild's last-played track; if that can't be
 * rebuilt, just grey every component. Refs we can't reach (a guild owned by a
 * different shard/pod) are left for the pod that can. Always best-effort.
 */
export async function expireStalePanels(client: Client): Promise<void> {
  const refs = await listAppSettingsByPrefix(PREFIX).catch(() => []);
  let retired = 0;
  for (const { key: refKey, value } of refs) {
    const guildId = refKey.slice(PREFIX.length);
    const [channelId, messageId] = value.split(':');
    if (!channelId || !messageId) {
      await forgetPanel(guildId);
      continue;
    }
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased()) {
        await forgetPanel(guildId);
        continue;
      }
      const message = await channel.messages.fetch(messageId);
      const last = await getLastPlayed(guildId);
      if (last) {
        const track = {
          info: { ...last, artworkUrl: null, duration: 0, isStream: false, sourceName: undefined },
        } as unknown as Track;
        await message.edit({
          flags: MessageFlags.IsComponentsV2,
          components: [
            nowPlayingCard(track, { disabled: true, withReplay: true, accentColor: cachedAccentColor(null) }),
          ],
        });
      } else {
        const components = message.components.map((c) => c.toJSON());
        disableAll(components as { type: number; disabled?: boolean; components?: unknown[] }[]);
        await message.edit({
          flags: message.flags.has(MessageFlags.IsComponentsV2)
            ? MessageFlags.IsComponentsV2
            : undefined,
          components: components as APIMessageTopLevelComponent[],
        });
      }
      retired += 1;
      await forgetPanel(guildId);
    } catch {
      // Message gone, or this pod can't reach the guild — leave the ref alone.
    }
  }
  if (retired > 0) logger.info({ retired }, 'retired stale now-playing panels from a previous run');
}
