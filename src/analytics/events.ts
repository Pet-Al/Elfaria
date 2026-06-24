import { SettingKeys, getBoolSetting } from '../db/appSettings.js';
import { db } from '../db/driver.js';
import { logger } from '../lib/logger.js';
import { publishEvent } from './kafka.js';

/**
 * Event/analytics pipeline (doc roadmap #3).
 *
 * A structured stream of play / skip / search events. Every event is written to
 * the `events` table (the always-available sink, queried by the co-play
 * recommender and the public stats API) and, when Kafka is configured, ALSO
 * published to a topic for a warehouse / stream processing. Recording is
 * fire-and-forget and fully fail-soft — analytics never affect playback.
 */

export type EventType = 'play' | 'skip' | 'search';

export interface AnalyticsEvent {
  type: EventType;
  guildId?: string | null;
  userId?: string | null;
  title?: string | null;
  uri?: string | null;
  author?: string | null;
  query?: string | null;
}

export function recordEvent(event: AnalyticsEvent): void {
  void (async () => {
    try {
      await db.run(
        `INSERT INTO events (guild_id, user_id, event_type, title, uri, author, query)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          event.guildId ?? null,
          event.userId ?? null,
          event.type,
          event.title ?? null,
          event.uri ?? null,
          event.author ?? null,
          event.query ?? null,
        ],
      );
    } catch (err) {
      logger.warn({ err, type: event.type }, 'failed to record analytics event');
    }
  })();
  void publishEvent(event);
}

/** GDPR data retention: drop play history + events older than `days`. */
export async function pruneOldData(days: number): Promise<void> {
  if (days <= 0) return;
  // Owner can disable the deletion entirely (/admin retention off).
  if (!(await getBoolSetting(SettingKeys.retentionEnabled, true).catch(() => true))) {
    logger.info('retention prune skipped — disabled by owner (/admin retention off)');
    return;
  }
  const cutoff = Math.floor(Date.now() / 1000) - days * 86_400;
  try {
    await db.run('DELETE FROM events WHERE created_at < ?', [cutoff]);
    await db.run('DELETE FROM play_history WHERE played_at < ?', [cutoff]);
  } catch (err) {
    logger.warn({ err }, 'data retention prune failed');
  }
}

/** GDPR right-to-erasure: delete everything tied to a user id. */
export async function forgetUser(userId: string): Promise<void> {
  await db.run('DELETE FROM favorites WHERE user_id = ?', [userId]);
  await db.run('DELETE FROM events WHERE user_id = ?', [userId]);
  await db.run('UPDATE play_history SET requester_id = NULL WHERE requester_id = ?', [userId]);
}
