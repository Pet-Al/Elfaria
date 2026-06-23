import { SpanStatusCode, trace } from '@opentelemetry/api';
import { logger } from './logger.js';

/**
 * Distributed tracing (doc roadmap, observability). Opt-in: tracing only starts
 * when OTEL_EXPORTER_OTLP_ENDPOINT is set (e.g. http://otel-collector:4318),
 * otherwise initTracing() is a no-op and the spans below become zero-cost.
 *
 * Auto-instrumentation captures the bot's outbound HTTP (the Lavalink REST/voice
 * calls, Discord's API), and the manual spans (command execution, source
 * resolve) give the bot→Lavalink picture. The SDK is dynamically imported so the
 * (large) OTel dependency tree is only loaded when tracing is actually enabled.
 */

let started = false;

export function initTracing(): void {
  if (started || !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  started = true;
  process.env.OTEL_SERVICE_NAME ??= 'elfaria';

  void (async () => {
    try {
      const { NodeSDK } = await import('@opentelemetry/sdk-node');
      const { getNodeAutoInstrumentations } = await import(
        '@opentelemetry/auto-instrumentations-node'
      );
      const sdk = new NodeSDK({
        instrumentations: [
          // The fs instrumentation is noisy and low-value for this workload.
          getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } }),
        ],
      });
      sdk.start();
      logger.info(
        { endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT },
        'OpenTelemetry tracing enabled',
      );
    } catch (err) {
      logger.warn({ err }, 'failed to start OpenTelemetry — continuing without tracing');
    }
  })();
}

const tracer = trace.getTracer('elfaria');

/**
 * Run `fn` inside a span. Safe to use unconditionally: when tracing is disabled
 * the OTel API returns a no-op span, so there's no overhead.
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    span.setAttributes(attributes);
    try {
      return await fn();
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}
