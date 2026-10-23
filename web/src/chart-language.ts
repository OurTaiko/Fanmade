import { normalizeLanguage } from './i18n'

type LocalizedChart = {
  title: string
  subtitle: string
  /** As the TJA has them: `origin` is TITLE/SUBTITLE itself, the other keys locales. */
  titleTranslations?: Partial<Record<'origin' | 'en' | 'zh' | 'ja' | 'ko' | 'zh_tw', string>>
  subtitleTranslations?: Partial<Record<'origin' | 'en' | 'zh' | 'ja' | 'ko' | 'zh_tw', string>>
}

/** The API returns all translations. Language selection and fallback belong here. */
export function chartText(chart: LocalizedChart, language?: string | null) {
  const normalized = normalizeLanguage(language)
  const key = normalized === 'zh-Hans' ? 'zh' : normalized
  const select = (field: 'title' | 'subtitle') => {
    const translations = field === 'title' ? chart.titleTranslations : chart.subtitleTranslations
    const preferred = translations?.[key]
    return (
      [preferred, translations?.en, translations?.origin, chart[field]].find((value) =>
        value?.trim(),
      ) ?? ''
    )
  }
  return { title: select('title'), subtitle: select('subtitle').replace(/^(--|\+\+)/, '') }
}
