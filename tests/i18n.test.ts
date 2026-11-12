import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { detectLanguage, initialLanguage, LANGUAGE_KEY, language, setLanguage, t } from '../src/i18n';
import { messages } from '../src/i18n-messages';
import { clone, defaultAircraft, presets, validateAircraft } from '../src/model';
import { materialCatalog } from '../src/materials';
import { challengeDefinitions } from '../src/challenges';
import { exportAircraft, importAircraft } from '../src/storage';

afterEach(() => { vi.unstubAllGlobals(); language.set('zh'); });

describe('language selection', () => {
 it('matches supported browser languages in preference order and falls back to English', () => {
  expect(detectLanguage(['fr-FR', 'ja-JP', 'en-US'])).toBe('ja');
  expect(detectLanguage(['zh-Hant-TW', 'en'])).toBe('zh');
  expect(detectLanguage(['en-GB', 'ja'])).toBe('en');
  expect(detectLanguage(['de-DE'])).toBe('en');
 });
 it('persists manual selection, restores it, and updates document language', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  vi.stubGlobal('document', { documentElement: { lang: '' } });
  vi.stubGlobal('navigator', { languages: ['en-US'], language: 'en-US' });
  setLanguage('ja');
  expect(get(language)).toBe('ja');
  expect(values.get(LANGUAGE_KEY)).toBe('ja');
  expect(initialLanguage()).toBe('ja');
  expect(document.documentElement.lang).toBe('ja');
  values.set(LANGUAGE_KEY, 'invalid');
  expect(initialLanguage()).toBe('en');
 });
 it('keeps language selection working when storage is blocked', () => {
  vi.stubGlobal('localStorage', { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } });
  vi.stubGlobal('document', { documentElement: { lang: '' } });
  vi.stubGlobal('navigator', { languages: ['ja-JP'], language: 'ja-JP' });
  expect(initialLanguage()).toBe('ja');
  expect(() => setLanguage('en')).not.toThrow();
  expect(get(language)).toBe('en');
 });
});

describe('shared translations', () => {
 it('ships English and Japanese for every catalog message with matching parameters', () => {
  const parameters = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const [source, translations] of Object.entries(messages)) {
   for (const translation of translations) {
    expect(translation.trim(), source).not.toBe('');
    expect(parameters(translation), source).toEqual(parameters(source));
   }
  }
 });
 it('distinguishes the auxiliary wing from aileron trim for issue #55', () => {
  expect(t('副翼', {}, 'en')).toBe('Auxiliary wing');
  expect(t('副翼', {}, 'ja')).toBe('補助翼');
  expect(t('副翼配平', {}, 'en')).toBe('Roll trim');
  expect(t('副翼配平', {}, 'ja')).toBe('ロールトリム');
 });
 it('translates wind tunnel axes, pilot motion and live incidence labels', () => {
  const labels = ['滚转控制', '俯仰控制', '主翼安装角', '副翼安装角'];
  for (const source of labels) for (const suffix of ['', '数值', '实际值']) {
   expect(t(source + suffix, {}, 'en')).not.toBe(source + suffix);
   expect(t(source + suffix, {}, 'ja')).not.toBe(source + suffix);
  }
  expect(t('滚转控制', {}, 'en')).toBe('Roll control');
  expect(t('俯仰控制', {}, 'ja')).toBe('ピッチ操作');
  for (const source of ['驾驶员横移', '驾驶员前后移']) for (const locale of ['en', 'ja'] as const) expect(t(source, {}, locale)).not.toBe(source);
 });
 it('translates product names, catalogs, presets, prompts and interpolated values', () => {
  const names = [defaultAircraft.name, ...presets.map(preset => preset.name), ...Object.values(materialCatalog).flatMap(material => [material.name, material.note, material.strengthLabel]), ...Object.values(challengeDefinitions).map(challenge => challenge.name)];
  for (const name of names) expect(messages[name], name).toBeDefined();
  expect(t('覆盖“{name}”？原设计将被替换。', { name: 'My aircraft $&' }, 'en')).toBe('Overwrite “My aircraft $&”? Its saved design will be replaced.');
  expect(t('检查点 {index} · {distance} m', { index: 3, distance: '123.4' }, 'ja')).toBe('チェックポイント 3 · 123.4 m');
 });
 it('translates validation and import errors without changing persisted design names or IDs', () => {
  language.set('en');
  const invalid = clone(defaultAircraft); invalid.fuselage.length = 99;
  expect(() => validateAircraft(invalid)).toThrow('Parameter must be between 3 and 12');
  expect(() => importAircraft(JSON.stringify(invalid))).toThrow('Invalid aircraft data: Parameter must be between 3 and 12');
  const design = clone(defaultAircraft); design.name = '我的设计 / My design';
  const restored = importAircraft(exportAircraft(design));
  expect(restored.name).toBe(design.name);
  expect(restored.mainWing.materialId).toBe(design.mainWing.materialId);
  expect(restored.engine.type).toBe(design.engine.type);
 });
});
