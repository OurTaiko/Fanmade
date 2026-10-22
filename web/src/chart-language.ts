import { normalizeLanguage } from './i18n'

type LocalizedChart = {
  title: string
  subtitle: string
  titleTranslations?: Partial<Record<'en' | 'zh' | 'ja' | 'ko', string>>
  subtitleTranslations?: Partial<Record<'en' | 'zh' | 'ja' | 'ko', string>>
}

/** The API returns all translations. Language selection and fallback belong here. */
export function chartText(chart: LocalizedChart, language?: string | null) {
  const normalized = normalizeLanguage(language)
  const key = normalized === 'zh-Hans' ? 'zh' : normalized
  const select = (field: 'title' | 'subtitle') => {
    const translations = field === 'title' ? chart.titleTranslations : chart.subtitleTranslations
    const preferred = translations?.[key]
    return [preferred, translations?.en, chart[field]].find((value) => value?.trim()) ?? ''
  }
  return { title: select('title'), subtitle: select('subtitle').replace(/^(--|\+\+)/, '') }
}
