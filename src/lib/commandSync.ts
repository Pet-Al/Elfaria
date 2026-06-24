import { createHash } from 'node:crypto';
import { REST, Routes } from 'discord.js';
import { commands } from '../commands/index.js';
import { config } from '../config.js';
import { getAppSetting, setAppSetting } from '../db/appSettings.js';
import { logger } from './logger.js';

/**
 * Slash-command registration — the SINGLE source of truth, shared by the
 * standalone deploy script (`deploy-commands.ts`) and the auto-sync on boot
 * (`events/ready.ts`). Having one implementation means "deploy" and "what the
 * running bot registers" can never drift apart.
 *
 * Why auto-sync on boot exists: registration used to be a separate manual step
 * (`npm run deploy`), so simply restarting/rebuilding the bot never pushed new
 * or changed commands — the usual cause of "my commands aren't global / aren't
 * updating". With AUTO_DEPLOY_COMMANDS on (the default) every boot re-registers
 * the current set GLOBALLY, idempotently.
 */

type RegisteredCommand = { name: string };

export interface SyncResult {
  count: number;
  /** How many commands were cleared from the configured guild to avoid duplicates. */
  cleared: number;
}

/**
 * Register the current command set GLOBALLY (the only scope Elfaria uses —
 * guild-scoped registration was removed because it's the sole cause of doubled
 * commands). Commands appear in EVERY server; the first time a *new* command
 * name is added, Discord can take up to ~1h to propagate it. Also clears the
 * configured dev-guild copy so nothing shows twice.
 */
export async function syncCommands(): Promise<SyncResult> {
  const rest = new REST().setToken(config.discord.token);
  const body = commands.map((command) => command.data.toJSON());
  const { clientId, guildId } = config.discord;

  await rest.put(Routes.applicationCommands(clientId), { body });
  let cleared = 0;
  if (guildId) {
    const existing = (await rest.get(
      Routes.applicationGuildCommands(clientId, guildId),
    )) as RegisteredCommand[];
    if (existing.length > 0) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
      cleared = existing.length;
    }
  }
  return { count: body.length, cleared };
}

/**
 * Clear GUILD-scoped commands from each of `guildIds`, returning how many guilds
 * actually had some. The nuclear de-dupe for leftover guild-scoped registrations
 * (from an older build) that double the global set in servers we don't track via
 * DISCORD_GUILD_ID.
 */
export async function clearGuildCommands(guildIds: string[]): Promise<number> {
  const rest = new REST().setToken(config.discord.token);
  const { clientId } = config.discord;
  let cleared = 0;
  for (const guildId of guildIds) {
    try {
      const existing = (await rest.get(
        Routes.applicationGuildCommands(clientId, guildId),
      )) as RegisteredCommand[];
      if (existing.length > 0) {
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
        cleared += 1;
      }
    } catch {
      // missing access / left guild — skip
    }
  }
  return cleared;
}

const HASH_KEY = 'commands_global_hash';

/** A short, stable hash of the current command definitions (names + shapes). */
export function commandsHash(): string {
  const bodies = commands.map((command) => command.data.toJSON());
  return createHash('sha256').update(JSON.stringify(bodies)).digest('hex').slice(0, 16);
}

/**
 * Idempotent boot reconciliation that GUARANTEES no duplicate commands.
 *
 * The dupe trap: Discord MERGES global + guild commands in the picker, so the
 * same name registered in BOTH scopes shows up twice. This:
 *   1. Re-PUTs the GLOBAL set only when the definitions actually changed (a hash
 *      stored in app_settings) — so a normal restart doesn't re-trigger Discord's
 *      ~1h global propagation, and the command set has exactly one home.
 *   2. ALWAYS clears the configured dev guild's copy, so a leftover guild-scoped
 *      registration (from an older build) can't coexist with the global set and
 *      double everything up.
 *
 * Fail-soft: any REST/DB hiccup is logged and swallowed — it must never block boot.
 */
export async function reconcileGlobalCommands(): Promise<{
  deployed: boolean;
  clearedGuild: number;
  unchanged: boolean;
}> {
  const rest = new REST().setToken(config.discord.token);
  const { clientId, guildId } = config.discord;
  const hash = commandsHash();

  let deployed = false;
  let unchanged = true;
  const stored = await getAppSetting(HASH_KEY).catch(() => undefined);
  if (stored !== hash) {
    await rest.put(Routes.applicationCommands(clientId), {
      body: commands.map((command) => command.data.toJSON()),
    });
    await setAppSetting(HASH_KEY, hash).catch((err) =>
      logger.warn({ err }, 'failed to persist command hash (will re-deploy next boot)'),
    );
    deployed = true;
    unchanged = false;
  }

  // Always reconcile the guild scope away — this is what kills dupes.
  let clearedGuild = 0;
  if (guildId) {
    const existing = (await rest.get(
      Routes.applicationGuildCommands(clientId, guildId),
    )) as RegisteredCommand[];
    if (existing.length > 0) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
      clearedGuild = existing.length;
      unchanged = false;
    }
  }

  return { deployed, clearedGuild, unchanged };
}
