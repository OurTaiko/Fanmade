import 'i18next'
import type zh from './locales/zh-Hans.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof zh }
    strictKeyChecks: true
  }
}
