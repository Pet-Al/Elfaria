/**
 * Internationalisation scaffold (doc roadmap).
 *
 * A tiny, dependency-free message catalogue so user-facing strings can be
 * localised per the invoking user's Discord client language. English is the
 * source of truth (every key defined); other locales provide partial overrides
 * and fall back to English for anything missing, so adding a language is purely
 * additive and can never crash on a missing key.
 *
 * Usage:
 *   import { t, localeOf } from '../lib/i18n.js';
 *   await reply(t('error.cooldown', localeOf(interaction), { seconds: '1.5' }));
 *
 * Adding a language: add its code to SUPPORTED_LOCALES and an entry in
 * `dictionaries` with whatever subset of keys you've translated.
 */

export const SUPPORTED_LOCALES = ['en', 'es', 'fr', 'de'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
const FALLBACK: SupportedLocale = 'en';

type Params = Record<string, string | number>;

/** The English catalogue — the complete set of keys (source of truth). */
const en = {
  'error.guildOnly': 'Elfaria commands can only be used in a server.',
  'error.cooldown': 'Slow down — try again in {seconds}s.',
  'error.generic': 'Something went wrong running that command.',
  'error.unknownCommand': "That command doesn't exist — try /help.",
} as const;

/** Every translatable message key. */
export type MessageKey = keyof typeof en;

/** Per-locale overrides; any key absent here falls back to English. */
const dictionaries: Record<SupportedLocale, Partial<Record<MessageKey, string>>> = {
  en,
  es: {
    'error.guildOnly': 'Los comandos de Elfaria solo se pueden usar en un servidor.',
    'error.cooldown': 'Más despacio — inténtalo de nuevo en {seconds}s.',
    'error.generic': 'Algo salió mal al ejecutar ese comando.',
    'error.unknownCommand': 'Ese comando no existe — prueba /help.',
  },
  fr: {
    'error.guildOnly': 'Les commandes Elfaria ne fonctionnent que dans un serveur.',
    'error.cooldown': 'Doucement — réessaie dans {seconds}s.',
    'error.generic': "Une erreur s'est produite lors de l'exécution de la commande.",
    'error.unknownCommand': "Cette commande n'existe pas — essaie /help.",
  },
  de: {
    'error.guildOnly': 'Elfaria-Befehle funktionieren nur auf einem Server.',
    'error.cooldown': 'Langsamer — versuch es in {seconds}s erneut.',
    'error.generic': 'Beim Ausführen des Befehls ist etwas schiefgelaufen.',
    'error.unknownCommand': 'Diesen Befehl gibt es nicht — probier /help.',
  },
};

/** Replace {placeholders} in a template with the provided params. */
function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in params ? String(params[key]) : `{${key}}`,
  );
}

/** Translate a key into `locale`, falling back to English, then interpolate. */
export function t(key: MessageKey, locale: SupportedLocale = FALLBACK, params?: Params): string {
  const template = dictionaries[locale]?.[key] ?? en[key];
  return interpolate(template, params);
}

/**
 * Resolve a Discord interaction's locale (e.g. "es-ES", "en-GB") to one of our
 * supported locales by language prefix, defaulting to English. Accepts any
 * object with a `locale` so commands, buttons and autocompletes all work.
 */
export function localeOf(interaction: { locale?: string | null }): SupportedLocale {
  const lang = (interaction.locale ?? '').slice(0, 2).toLowerCase();
  return (SUPPORTED_LOCALES as readonly string[]).includes(lang)
    ? (lang as SupportedLocale)
    : FALLBACK;
}
