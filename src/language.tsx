import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { i18n, normalizeLanguage, formatLocale, browserLanguage } from './i18n'
import { useSession } from './session-context'

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { user } = useSession()
  const language = user ? normalizeLanguage(user.preferredLanguage) : null
  useEffect(() => {
    const updateLanguage = () => {
      void i18n.changeLanguage(language ?? browserLanguage())
    }
    updateLanguage()
    if (language !== null) return
    window.addEventListener('languagechange', updateLanguage)
    return () => window.removeEventListener('languagechange', updateLanguage)
  }, [language])
  return children
}

export function DocumentLanguage() {
  const { t, i18n: instance } = useTranslation()
  useEffect(() => {
    document.documentElement.lang = formatLocale(instance.resolvedLanguage)
    document.title = t('common.siteTitle')
  }, [instance.resolvedLanguage, t])
  return null
}
