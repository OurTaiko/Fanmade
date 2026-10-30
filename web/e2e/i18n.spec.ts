import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Chart, User } from '../src/api/types'

test.use({ locale: 'en-US' })

const chart: Chart = {
  id: 'language-chart',
  title: 'Original title',
  subtitle: '--Original subtitle',
  titleTranslations: { en: 'English title', zh: '中文曲名', ja: '日本語の曲名', ko: '한국어 곡명' },
  subtitleTranslations: {
    en: '--English subtitle',
    zh: '中文副标题',
    ja: '--日本語の副題',
    ko: '한국어 부제',
  },
  ownerId: 'language-user',
  uploader: 'Test creator',
  categoryIds: [],
  description: '',
  createdAt: '2026-09-22T00:00:00Z',
  duration: 60,
  encoding: 'utf-8',
  tjaName: 'test.tja',
  audioName: 'test.ogg',
  tjaHash: 'test',
  audioHash: 'test',
  audioSize: 100,
  maker: 'Maker',
  bpm: 120,
  offset: 0,
  demoStart: 0,
  wave: 'test.ogg',
  difficulties: [
    {
      course: 'Oni',
      side: 'single',
      level: 5,

      maker: 'Maker',
    },
  ],
}
async function fixture(page: Page, language?: string, loggedIn = true) {
  let user: User | null = loggedIn
    ? {
        id: 'language-user',
        username: 'Tester',
        nickname: 'Tester',
        emailVerified: true,
        isAdmin: false,
        preferredLanguage: language,
      }
    : null
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/me') return route.fulfill({ json: { user, csrfToken: 'test' } })
    if (path.endsWith('/logout')) {
      user = null
      return route.fulfill({ json: {} })
    }
    if (path.endsWith('/categories')) return route.fulfill({ json: { items: [] } })
    if (path.endsWith('/comments'))
      return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } })
    if (path.endsWith('/tja'))
      return route.fulfill({
        body: 'TITLE:Original title\nBPM:120\nCOURSE:Oni\nLEVEL:5\n#START\n1000,\n#END\n',
      })
    if (path.endsWith('/leaderboard'))
      return route.fulfill({
        json: { items: [], total: 0, page: 1, pageSize: 20, supported: true },
      })
    if (path === '/api/v1/charts/language-chart') return route.fulfill({ json: chart })
    return route.fulfill({ json: { items: [chart], total: 1, page: 1, pageSize: 20 } })
  })
  return {
    setLanguage(value: string) {
      if (user) user = { ...user, preferredLanguage: value }
    },
  }
}

for (const [language, htmlLanguage, heading, title, subtitle] of [
  ['zh-hans', 'zh-CN', '发现谱面', '中文曲名', '中文副标题'],
  ['en', 'en', 'Explore charts', 'English title', 'English subtitle'],
  ['ja', 'ja', '譜面を探す', '日本語の曲名', '日本語の副題'],
  ['ko', 'ko', '채보 둘러보기', '한국어 곡명', '한국어 부제'],
]) {
  test(`SSO ${language} renders library, details and mobile layout`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await fixture(page, language)
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('lang', htmlLanguage)
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    const card = page.getByTestId('chart-card')
    await expect(card).toContainText(title)
    await expect(card).toContainText(subtitle)
    await card.click()
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await expect(page.locator('canvas')).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true)
    await page.screenshot({ path: `test-results/i18n-${language}-mobile.png`, fullPage: true })
    await expect(page.locator('body')).not.toContainText(/\{\{\w+\}\}/)
    expect(errors).toEqual([])
  })
}

test('refreshes account language on focus, keeps edit draft and follows browser after logout', async ({
  page,
}) => {
  const account = await fixture(page, 'en')
  await page.goto('/charts/language-chart')
  await page.getByRole('button', { name: 'Edit information', exact: true }).click()
  await page.getByRole('tab', { name: 'Translations', exact: true }).click()
  await page.locator('#edit-ja-title').fill('Unsaved draft')
  account.setLanguage('ja')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
  await page.evaluate(() => window.dispatchEvent(new Event('languagechange')))
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
  await expect(page.getByRole('dialog')).toContainText('譜面情報を編集')
  await expect(page.locator('#edit-ja-title')).toHaveValue('Unsaved draft')
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('heading', { name: 'English title', exact: true })).toBeVisible()
})

test('saving a translated title keeps the cover and returns focus to edit information', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await fixture(page, 'zh-hans')
  let current = { ...chart, coverHash: 'existing-cover' }
  await page.route('**/api/v1/charts/language-chart', async (route) => {
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON()
      expect(patch).toEqual({ titleTranslations: { zh: '保存后的译名' } })
      current = {
        ...current,
        titleTranslations: { ...current.titleTranslations, ...patch.titleTranslations },
      }
    }
    await route.fulfill({ json: current })
  })
  await page.route('**/api/v1/charts/language-chart/cover?*', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="red"/></svg>',
    }),
  )
  await page.goto('/charts/language-chart')
  const cover = page.locator('main img').first()
  await expect.poll(() => cover.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(40)
  const source = await cover.getAttribute('src')
  const edit = page.getByRole('button', { name: '编辑信息', exact: true })
  await edit.click()
  await page.getByRole('tab', { name: '译名', exact: true }).click()
  await page.getByLabel('中文歌名', { exact: true }).fill('保存后的译名')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  const success = page.getByRole('dialog', { name: '操作成功' })
  await expect(success).toContainText('谱面信息已保存。')
  await success.getByRole('button', { name: '知道了', exact: true }).click()
  await expect(success).toHaveCount(0)
  await expect(edit).toBeFocused()
  await expect(page.getByRole('heading', { name: '保存后的译名', exact: true })).toBeVisible()
  await expect(cover).toHaveAttribute('src', source!)
  await expect.poll(() => cover.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(40)
  await expect(page.getByText('暂无封面', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '跳到主要内容', includeHidden: true })).toHaveCount(0)
  await edit.click()
  await page.getByRole('tab', { name: '译名', exact: true }).click()
  await expect(page.getByLabel('中文歌名', { exact: true })).toHaveValue('保存后的译名')
  await page.keyboard.press('Escape')
  await expect(edit).toBeFocused()
  expect(errors).toEqual([])
})

for (const language of [undefined, 'invalid-language']) {
  test(`missing or unsupported preference falls back to Chinese: ${language}`, async ({ page }) => {
    await fixture(page, language)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '发现谱面' })).toBeVisible()
    await expect(page.getByTestId('chart-card')).toContainText('中文曲名')
  })
}

for (const [locale, htmlLanguage, title] of [
  ['en-US', 'en', 'English title'],
  ['zh-TW', 'zh-CN', '中文曲名'],
  ['ja-JP', 'ja', '日本語の曲名'],
  ['ko-KR', 'ko', '한국어 곡명'],
  ['de-DE', 'en', 'English title'],
]) {
  test.describe(`browser language ${locale}`, () => {
    test.use({ locale })
    test('anonymous visitors follow the browser language', async ({ page }) => {
      await fixture(page, undefined, false)
      await page.goto('/')
      await expect(page.locator('html')).toHaveAttribute('lang', htmlLanguage)
      await expect(page.getByTestId('chart-card')).toContainText(title)
    })
  })
}

test('anonymous visitors match browser preferences in order and react to language changes', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'languages', {
      configurable: true,
      value: ['de-DE', 'ja-JP', 'ko-KR'],
    })
  })
  await fixture(page, undefined, false)
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
  await expect(page.getByTestId('chart-card')).toContainText('日本語の曲名')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'languages', { configurable: true, value: ['ko-KR', 'en-US'] })
    window.dispatchEvent(new Event('languagechange'))
  })
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko')
  await expect(page.getByTestId('chart-card')).toContainText('한국어 곡명')
})

test('English edits use the same translation dictionary and preserve other languages', async ({
  page,
}) => {
  await fixture(page, 'en')
  let current = { ...chart }
  await page.route('**/api/v1/charts/language-chart', async (route) => {
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON()
      expect(patch).toEqual({ titleTranslations: { en: 'Edited English' } })
      current = {
        ...current,
        titleTranslations: { ...current.titleTranslations, ...patch.titleTranslations },
      }
    }
    await route.fulfill({ json: current })
  })
  await page.goto('/charts/language-chart')
  await expect(page.getByRole('heading', { name: 'English title', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit information', exact: true }).click()
  await page.getByRole('tab', { name: 'Translations', exact: true }).click()
  await expect(page.locator('#edit-en-title')).toHaveValue('English title')
  await page.locator('#edit-en-title').fill('Edited English')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Success' })
    .getByRole('button', { name: 'Got it', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Edited English', exact: true })).toBeVisible()
  expect(current.title).toBe('Original title')
  expect(current.titleTranslations.ja).toBe('日本語の曲名')
  expect(current.titleTranslations.zh).toBe('中文曲名')
  expect(current.titleTranslations.ko).toBe('한국어 곡명')
})
