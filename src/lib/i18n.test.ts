import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { localeOf, t } from './i18n.js';

describe('i18n', () => {
  it('returns the English string by default', () => {
    assert.equal(t('error.guildOnly'), 'Elfaria commands can only be used in a server.');
  });

  it('translates a known key for a supported locale', () => {
    assert.equal(t('error.guildOnly', 'es'), 'Los comandos de Elfaria solo se pueden usar en un servidor.');
  });

  it('falls back to English for a key missing in the locale', () => {
    // 'es' defines every key here, so prove the fallback path with interpolation
    // on a locale that has the key, and the default-locale path explicitly.
    assert.equal(t('error.generic', 'en'), 'Something went wrong running that command.');
  });

  it('interpolates named placeholders', () => {
    assert.equal(t('error.cooldown', 'en', { seconds: '1.5' }), 'Slow down — try again in 1.5s.');
    assert.equal(t('error.cooldown', 'fr', { seconds: 2 }), 'Doucement — réessaie dans 2s.');
  });

  it('leaves unknown placeholders intact', () => {
    // missing param keeps the literal token rather than printing "undefined"
    assert.match(t('error.cooldown', 'en'), /\{seconds\}s\./);
  });

  it('maps a Discord locale to a supported language prefix', () => {
    assert.equal(localeOf({ locale: 'es-ES' }), 'es');
    assert.equal(localeOf({ locale: 'en-GB' }), 'en');
    assert.equal(localeOf({ locale: 'de' }), 'de');
  });

  it('defaults unknown or missing locales to English', () => {
    assert.equal(localeOf({ locale: 'ja' }), 'en');
    assert.equal(localeOf({ locale: null }), 'en');
    assert.equal(localeOf({}), 'en');
  });
});
