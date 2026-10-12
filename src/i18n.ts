import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import zh from './locales/zh-Hans.json'
import en from './locales/en.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'

export const languageNames = {
  'zh-Hans': '简体中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
} as const
export type Language = keyof typeof languageNames
export function normalizeLanguage(value?: string | null): Language {
  const code = value?.trim().toLowerCase().replaceAll('_', '-') ?? ''
  if (code === 'zh' || code === 'zh-cn' || code === 'zh-sg' || code === 'zh-hans') return 'zh-Hans'
  const base = code.split('-')[0]
  return base === 'en' || base === 'ja' || base === 'ko' ? base : 'zh-Hans'
}
export function formatLocale(language?: string): string {
  return normalizeLanguage(language) === 'zh-Hans' ? 'zh-CN' : normalizeLanguage(language)
}

export function browserLanguage(): Language {
  const languages =
    typeof navigator === 'undefined'
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language]
  for (const language of languages) {
    const base = language.trim().toLowerCase().replaceAll('_', '-').split('-')[0]
    if (base === 'zh') return 'zh-Hans'
    if (base === 'en' || base === 'ja' || base === 'ko') return base
  }
  return 'en'
}

// Start with the browser language; LanguageProvider applies the SSO preference
// once the session is available. No separate preference is stored locally.
export const i18n = i18next.createInstance()
void i18n.use(initReactI18next).init({
  resources: {
    'zh-Hans': { translation: zh },
    en: { translation: en },
    ja: { translation: ja },
    ko: { translation: ko },
  },
  lng: browserLanguage(),
  fallbackLng: 'zh-Hans',
  supportedLngs: Object.keys(languageNames),
  load: 'currentOnly',
  initAsync: false,
  interpolation: { escapeValue: false }, // React escapes rendered values.
  returnNull: false,
  returnEmptyString: false,
})
// Utilities translate at call time; React components use useTranslation instead.
export const t = i18n.t.bind(i18n)
