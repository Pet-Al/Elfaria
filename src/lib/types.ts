import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  ClientEvents,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';

/**
 * A slash command module (doc §2 "command layer").
 *
 * Each command exports a `data` builder (the schema Discord renders) and an
 * `execute` function. The router in events/interactionCreate.ts looks the
 * command up by name and runs it, applying the per-user cooldown.
 */
export interface Command {
  /** The command definition registered with Discord's REST API. */
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
  /** Per-user cooldown in ms; falls back to config.commands.defaultCooldownMs. */
  cooldownMs?: number;
  execute(interaction: ChatInputCommandInteraction): Promise<void> | void;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void> | void;
}

/**
 * A gateway event handler module (doc §1). Each event file exports one of
 * these; the loader binds it to the client with .on()/.once().
 */
export interface BotEvent<K extends keyof ClientEvents = keyof ClientEvents> {
  name: K;
  once?: boolean;
  execute: (...args: ClientEvents[K]) => unknown;
}
