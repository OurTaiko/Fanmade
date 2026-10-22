import i18next from 'i18next'
import { afterEach, describe, expect, it } from 'vitest'
import { i18n, normalizeLanguage } from './i18n'
import { chartText } from './chart-language'
import zh from './locales/zh-Hans.json'
import en from './locales/en.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'

const chart = {
  title: 'Original',
  subtitle: '--Original subtitle',
  titleTranslations: {
    en: 'English translation',
    zh: '中文曲名',
    ja: '日本語の曲名',
    ko: '한국어 곡명',
  },
  subtitleTranslations: {
    en: '--English subtitle',
    zh: '++中文副标题',
    ja: '--日本語の副題',
    ko: '한국어 부제',
  },
}
afterEach(() => {
  void i18n.changeLanguage('zh-Hans')
})

describe('account language and chart fallback', () => {
  it.each([
    [undefined, 'zh-Hans'],
    ['', 'zh-Hans'],
    ['de', 'zh-Hans'],
    ['zh-CN', 'zh-Hans'],
    ['en-US', 'en'],
    ['ja-JP', 'ja'],
    ['ko-KR', 'ko'],
  ])('normalizes %s to %s', (value, expected) => {
    expect(normalizeLanguage(value)).toBe(expected)
  })
  it.each([
    ['zh-Hans', '中文曲名', '中文副标题'],
    ['en', 'English translation', 'English subtitle'],
    ['ja', '日本語の曲名', '日本語の副題'],
    ['ko', '한국어 곡명', '한국어 부제'],
  ])('uses %s for title and subtitle independently', (language, title, subtitle) => {
    expect(chartText(chart, language)).toEqual({ title, subtitle })
  })
  it('falls back to English in the UI while keeping all server translations', () => {
    const translated = {
      ...chart,
      titleTranslations: { en: 'English translation', zh: '中文' },
      subtitleTranslations: { en: '--English subtitle' },
    }
    const before = JSON.stringify(translated)
    expect(chartText(translated, 'ja')).toEqual({
      title: 'English translation',
      subtitle: 'English subtitle',
    })
    expect(JSON.stringify(translated)).toBe(before)
  })
  it('falls back directly to original fields without changing source metadata', () => {
    const missing = {
      ...chart,
      titleTranslations: { zh: '中文曲名' },
      subtitleTranslations: { zh: '中文副标题', ja: '  ' },
    }
    expect(chartText(missing, 'ja')).toEqual({ title: 'Original', subtitle: 'Original subtitle' })
    expect(chartText(missing, 'ko')).toEqual({ title: 'Original', subtitle: 'Original subtitle' })
    expect(chartText(chart)).toEqual({ title: '中文曲名', subtitle: '中文副标题' })
    expect(chartText({ title: 'Original', subtitle: '' }, 'ko')).toEqual({
      title: 'Original',
      subtitle: '',
    })
    expect(chart.subtitle).toBe('--Original subtitle')
  })
})

it('keeps every catalogue complete with matching interpolation variables', () => {
  for (const catalogue of [en, ja, ko]) {
    expect(Object.keys(catalogue.messages).sort()).toEqual(Object.keys(zh.messages).sort())
    for (const key of Object.keys(zh.messages) as (keyof typeof zh.messages)[]) {
      expect(catalogue.messages[key].trim(), key).not.toBe('')
      const vars = (text: string) => [...text.matchAll(/{{(.*?)}}/g)].map((m) => m[1]).sort()
      expect(vars(catalogue.messages[key]), key).toEqual(vars(zh.messages[key]))
    }
  }
})

it('uses plural forms and resolves missing translations to Chinese', async () => {
  await i18n.changeLanguage('en')
  expect(i18n.t('common.playerCount', { count: 1 })).toBe('1 player')
  expect(i18n.t('common.playerCount', { count: 2 })).toBe('2 players')
  // An isolated namespace avoids modifying production resources for this test.
  const isolated = i18next.createInstance()
  await isolated.init({
    lng: 'en',
    fallbackLng: 'zh-Hans',
    resources: {
      'zh-Hans': { translation: { messages: { saveChanges: '中文回退' } } },
      en: { translation: {} },
    },
  })
  expect(isolated.t('messages.saveChanges')).toBe('中文回退')
})

it('localizes API error codes and keeps line diagnostics', async () => {
  const { apiErrorMessage } = await import('./api/error-message')
  await i18n.changeLanguage('ja')
  expect(apiErrorMessage({ code: 'UNAUTHORIZED', message: '请先登录' })).toBe(
    'ログインしてください。',
  )
  expect(apiErrorMessage({ code: 'TJA_STRUCTURE_INVALID', line: 3 })).toContain('3 行目')
  expect(apiErrorMessage({ code: 'UNKNOWN', message: '未翻译文本' })).toBe(
    'リクエストに失敗しました',
  )
})

it('preserves localized TJA fields for the upload preview', async () => {
  const { parseTja } = await import('./tja')
  const data = new TextEncoder().encode(
    'TITLE:Original\nTITLEEN:English translation\nSUBTITLEEN:English subtitle\nTITLEZH:中文曲名\nTITLEJA:日本語\nSUBTITLEKO:한국어 부제\nWAVE:audio.ogg\nBPM:120\nCOURSE:Oni\nLEVEL:1\n#START\n1000,\n#END\n',
  )
  const metadata = parseTja(data, 'utf-8', 'audio.ogg')
  expect(chartText(metadata, 'ko')).toEqual({
    title: 'English translation',
    subtitle: '한국어 부제',
  })
  expect(metadata.titleTranslations?.en).toBe('English translation')
  expect(metadata.subtitleTranslations?.en).toBe('English subtitle')
  expect(metadata.title).toBe('Original')
})

it('supplies every interpolation parameter at static translation call sites', async () => {
  const ts = await import('typescript')
  const { readdirSync, readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const root = resolve('src')
  const failures: string[] = []
  for (const file of readdirSync(root, { recursive: true }) as string[]) {
    if (!/\.(ts|tsx)$/.test(file) || file.includes('.test.')) continue
    const source = ts.createSourceFile(
      file,
      readFileSync(resolve(root, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    function visit(node: import('typescript').Node) {
      if (ts.isCallExpression(node) && /^(?:i18n\.)?t$/.test(node.expression.getText(source))) {
        const [keyNode, options] = node.arguments
        if (keyNode && ts.isStringLiteral(keyNode)) {
          const parts = keyNode.text.split('.')
          let message: unknown = zh
          for (const part of parts) {
            const record = message as Record<string, unknown>
            message = record?.[part] ?? record?.[`${part}_other`]
          }
          if (typeof message === 'string') {
            const supplied =
              options && ts.isObjectLiteralExpression(options)
                ? options.properties.flatMap((p) => (p.name ? [p.name.getText(source)] : []))
                : []
            for (const match of message.matchAll(/{{(\w+)}}/g)) {
              if (!supplied.includes(match[1]))
                failures.push(`${file}: ${keyNode.text} needs ${match[1]}`)
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  expect(failures).toEqual([])
})
