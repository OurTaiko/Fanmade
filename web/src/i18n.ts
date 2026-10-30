// The website's text: OurTaikoSiteKit's shared catalogues, then this site's own keys
// and overrides. Import i18n from here, so the site's keys are in place first.
import { addSiteCatalogues } from '@sitekit/i18n'
import zh from './locales/zh-Hans.json'
import en from './locales/en.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'

export * from '@sitekit/i18n'
addSiteCatalogues({ 'zh-Hans': zh, en, ja, ko })
