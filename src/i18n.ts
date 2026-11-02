import { get, writable, type Writable } from 'svelte/store';
import { messages } from './i18n-messages';

export type Language = 'zh' | 'en' | 'ja';
export type TranslationParams = Record<string, string | number>;
export const LANGUAGE_KEY = 'aero-formula.language';

export function detectLanguage(preferences: readonly string[]): Language {
 for (const preference of preferences) {
  const code = preference.toLowerCase().split(/[-_]/)[0];
  if (code === 'zh' || code === 'ja' || code === 'en') return code;
 }
 return 'en';
}

export function initialLanguage(): Language {
 try {
  const saved = globalThis.localStorage?.getItem(LANGUAGE_KEY);
  if (saved === 'zh' || saved === 'en' || saved === 'ja') return saved;
 } catch { /* Browser language still works when storage is blocked. */ }
 return typeof document === 'undefined' || typeof navigator === 'undefined' ? 'zh' : detectLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

// Vite can serve several timestamped module URLs during HMR. Keep one store per module hot context.
const retainedLanguage = import.meta.hot?.data.language as Writable<Language> | undefined;
export const language = retainedLanguage ?? writable<Language>(initialLanguage());
if (import.meta.hot) import.meta.hot.data.language = language;
if (!retainedLanguage) language.subscribe(value => { if (typeof document !== 'undefined') document.documentElement.lang = value; });

export function setLanguage(value: Language): void {
 language.set(value);
 try { globalThis.localStorage?.setItem(LANGUAGE_KEY, value); } catch { /* This session keeps the selected language. */ }
}

export function t(source: string, params?: TranslationParams, locale: Language = get(language)): string {
 const text = locale === 'zh' ? source : messages[source]?.[locale === 'en' ? 0 : 1] ?? source;
 return params ? text.replace(/\{(\w+)\}/g, (token, key: string) => String(params[key] ?? token)) : text;
}
