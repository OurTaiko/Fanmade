import 'i18next'
import type shared from '@sitekit/locales/zh-Hans.json'
import type site from './locales/zh-Hans.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    // OurTaikoSiteKit's catalogue with this site's keys added (see i18n.ts).
    resources: { translation: typeof shared & typeof site }
    strictKeyChecks: true
  }
}
