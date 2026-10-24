import { expect, test } from '@playwright/test'
import type { Chart } from '../src/api/types'

// These browser tests use isolated API responses; no account or upload is persisted.
const courses = ['Easy', 'Normal', 'Hard', 'Oni', 'Edit']
const chart: Chart = {
  id: '1'.repeat(32),
  ownerId: 'fixture-user',
  uploader: 'tester',
  title: '普通谱面预览',
  subtitle: '',
  maker: 'tester',
  bpm: 120,
  offset: 0,
  demoStart: 0,
  wave: 'music.ogg',
  description: '',
  createdAt: '2026-09-14T12:00:00Z',
  duration: 10,
  encoding: 'utf-8',
  tjaName: 'chart.tja',
  audioName: 'music.ogg',
  tjaHash: 'a'.repeat(64),
  audioHash: 'b'.repeat(64),
  audioSize: 100,
  titleTranslations: {},
  subtitleTranslations: {},
  difficulties: courses.map((course, blockIndex) => ({
    course,

    level: 5,

    maker: '',
  })),
}
const tja = (values: string[]) =>
  'TITLE:普通谱面预览\nBPM:120\nWAVE:music.ogg\n' +
  values.map((course) => `COURSE:${course}\nLEVEL:5\n#START\n1122,\n#END\n`).join('')
const unsupported = ['Tower', 'Dan'].map((course, index) => ({
  ...chart,
  id: String(index + 2).repeat(32),
  title: `不支持的${course}作品`,
  difficulties: [...chart.difficulties, { ...chart.difficulties[0], course }],
}))

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/me')
      return route.fulfill({
        json: {
          user: {
            id: chart.ownerId,
            username: 'tester',
            nickname: '测试昵称',
            isAdmin: false,
            emailVerified: true,
          },
          csrfToken: 'fixture',
        },
      })
    if (path === '/api/v1/charts')
      return route.fulfill({
        json: { items: [chart, ...unsupported], total: 3, page: 1, pageSize: 12 },
      })
    if (path.endsWith('/tja')) return route.fulfill({ body: tja(courses) })
    if (path.endsWith('/audio')) return route.fulfill({ contentType: 'audio/ogg', body: '' })
    const selected = [chart, ...unsupported].find((c) => path === `/api/v1/charts/${c.id}`)
    return selected
      ? route.fulfill({ json: selected })
      : route.fulfill({ status: 404, json: { message: 'Fixture route not found' } })
  })
})

test('ordinary preview; unsupported cards and details stay hidden', async ({ page }) => {
  const errors: string[] = []
  const assets: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (/\/api\/v1\/charts\/[^/]+\/(tja|audio|download)(?:\?|$)/.test(request.url()))
      assets.push(request.url())
  })
  await page.goto('/')
  await expect(page.locator('[data-testid="chart-card"]')).toHaveCount(1)
  await expect(page.getByText('不支持的Tower作品')).toHaveCount(0)
  await expect(page.getByText('不支持的Dan作品')).toHaveCount(0)
  for (const entry of unsupported) {
    await page.goto(`/charts/${entry.id}`)
    await expect(page.getByRole('alertdialog')).toContainText('该谱面类型不受支持')
    await expect(page.locator('canvas, audio')).toHaveCount(0)
    await expect(page.getByRole('link', { name: '下载谱面包' })).toHaveCount(0)
  }
  expect(assets).toEqual([])
  await page.goto(`/charts/${chart.id}`)
  const difficultyTabs = page.getByRole('tablist', { name: '选择难度', exact: true })
  await expect(difficultyTabs.getByRole('tab')).toHaveCount(5)
  await expect(difficultyTabs.getByRole('tab', { name: /^魔王/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.locator('canvas')).toBeVisible()
  await difficultyTabs.getByRole('tab', { name: /^里谱/ }).click()
  await expect(page.locator('canvas')).toHaveAttribute('aria-label', 'Edit 难度交互谱面预览')
  expect(errors).toEqual([])
})

test('mixed Tower/Dan and numeric aliases cannot upload; replacing with Oni restores the form', async ({
  page,
}) => {
  const uploads: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/charts')
      uploads.push(request.url())
  })
  await page.goto('/me/charts/publish')
  await page.getByLabel('选择 OGG 或 MP3 音频').setInputFiles({
    name: 'music.ogg',
    mimeType: 'audio/ogg',
    buffer: Buffer.from('OggS fixture'),
  })
  for (const course of ['Tower', 'Dan', '5', '6', 'tOwEr', 'dAn']) {
    await page.getByLabel('选择 TJA 谱面').setInputFiles({
      name: `${course}.tja`,
      mimeType: 'text/plain',
      buffer: Buffer.from(tja(['Oni', course])),
    })
    await expect(page.getByRole('alertdialog')).toContainText('不支持塔（Tower）或段位（Dan）谱面')
    await expect(page.getByText('本地校验通过')).toHaveCount(0)
    await page.getByRole('button', { name: '知道了', exact: true }).click()
    await expect(page.getByRole('button', { name: '发布谱面', exact: true })).toBeDisabled()
  }
  await page.getByLabel('选择 TJA 谱面').setInputFiles({
    name: 'valid.tja',
    mimeType: 'text/plain',
    buffer: Buffer.from(tja(['Oni'])),
  })
  await expect(page.getByRole('dialog', { name: '本地校验通过' })).toBeVisible()
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  await expect(page.getByRole('button', { name: '发布谱面', exact: true })).toBeEnabled()
  expect(uploads).toEqual([])
})
