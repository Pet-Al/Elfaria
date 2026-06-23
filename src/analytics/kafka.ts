import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import type { AnalyticsEvent } from './events.js';

/**
 * Optional Kafka producer for the event pipeline (doc roadmap #3). Only active
 * when KAFKA_BROKERS is set; kafkajs is an OPTIONAL dependency and is imported
 * dynamically, so a deploy without Kafka pays nothing. Entirely fail-soft — a
 * broker hiccup never affects playback (events are also written to the DB).
 */

type Producer = import('kafkajs').Producer;
let producerPromise: Promise<Producer | null> | null = null;

async function getProducer(): Promise<Producer | null> {
  if (config.kafka.brokers.length === 0) return null;
  if (!producerPromise) {
    producerPromise = (async () => {
      const { Kafka } = await import('kafkajs');
      const producer = new Kafka({ clientId: 'elfaria', brokers: config.kafka.brokers }).producer();
      await producer.connect();
      logger.info({ brokers: config.kafka.brokers }, 'kafka producer connected');
      return producer;
    })().catch((err) => {
      logger.warn({ err }, 'kafka connect failed — events go to the DB only');
      return null;
    });
  }
  return producerPromise;
}

export async function publishEvent(event: AnalyticsEvent): Promise<void> {
  try {
    const producer = await getProducer();
    if (!producer) return;
    await producer.send({
      topic: config.kafka.topic,
      messages: [{ key: event.guildId ?? '', value: JSON.stringify({ ...event, ts: Date.now() }) }],
    });
  } catch (err) {
    logger.warn({ err }, 'kafka publish failed');
  }
}
