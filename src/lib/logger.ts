import { pino } from 'pino';
import { config } from '../config.js';

/**
 * Structured logging (doc §10 "Error logging").
 *
 * We log JSON (machine-queryable) in production and pretty-print in development.
 * Use child loggers (`logger.child({ guildId })`) to attach context so that a
 * single failed track in a single guild can be traced later.
 */
export const logger = pino({
  level: config.log.level,
  base: { service: 'elfaria' },
  transport: config.isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname,service',
        },
      },
});

export type Logger = typeof logger;
