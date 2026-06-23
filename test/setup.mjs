// Loaded via `node --import ./test/setup.mjs` BEFORE the TypeScript loader, so
// config.ts (which validates env at import time) has values to read. Tests
// exercise pure logic, not a live Discord/DB connection, so dummy creds suffice.
// (globalThis.process keeps the linter happy without a Node-globals env here.)
const { env } = globalThis.process;
env.DISCORD_TOKEN ||= 'test-token';
env.DISCORD_CLIENT_ID ||= 'test-client-id';
env.METRICS_ENABLED ||= 'false';
env.LOG_LEVEL ||= 'silent';
// The DB integration test uses a throwaway SQLite file under .test-data/.
env.DATABASE_PATH ||= './.test-data/elfaria-test.db';
