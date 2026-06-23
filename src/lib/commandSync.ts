import { REST, Routes } from 'discord.js';
import { commands } from '../commands/index.js';
import { config } from '../config.js';

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

export type CommandScope = 'global' | 'guild';

export interface SyncResult {
  scope: CommandScope;
  count: number;
  /** How many commands were cleared from the *other* scope to avoid duplicates. */
  cleared: number;
}

/**
 * Register the current command set with Discord.
 *
 * - `global` (default; what most deploys want): commands appear in EVERY server
 *   the bot is in. The first time a *new* command is added, Discord can take up
 *   to ~1 hour to propagate it to clients — existing commands are unaffected.
 *   Also clears the configured dev-guild copy so nothing shows twice.
 * - `guild`: instant, but only in `DISCORD_GUILD_ID` — the fast dev/iteration
 *   path. Clears the global set so commands don't appear twice. Falls back to
 *   global automatically when no guild is configured.
 */
export async function syncCommands(scope: CommandScope = 'global'): Promise<SyncResult> {
  const rest = new REST().setToken(config.discord.token);
  const body = commands.map((command) => command.data.toJSON());
  const { clientId, guildId } = config.discord;

  // 'guild' is only meaningful when a guild is configured; otherwise force global.
  const effective: CommandScope = scope === 'guild' && guildId ? 'guild' : 'global';

  if (effective === 'global') {
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
    return { scope: 'global', count: body.length, cleared };
  }

  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
  const existingGlobal = (await rest.get(
    Routes.applicationCommands(clientId),
  )) as RegisteredCommand[];
  let cleared = 0;
  if (existingGlobal.length > 0) {
    await rest.put(Routes.applicationCommands(clientId), { body: [] });
    cleared = existingGlobal.length;
  }
  return { scope: 'guild', count: body.length, cleared };
}
