import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { Chart } from '../src/api/types'

const source =
  'TITLE:Maker test\nSUBTITLE:Subtitle\nMAKER:A\nBPM:120\nWAVE:cbr.mp3\n' +
  ['Hard', 'Oni', 'Edit']
    .map((course) => `COURSE:${course}\nLEVEL:5\n#START\n1000,\n#END\n`)
    .join('')
const audio = readFileSync('../kit/audio/testdata/cbr.mp3')
const chart: Chart = {
  id: 'a'.repeat(32),
  ownerId: 'owner',
  uploader: 'tester',
  title: 'Maker test',
  subtitle: 'Subtitle',
  maker: 'A | B',
  bpm: 120,
  offset: 0,
  demoStart: 0,
  wave: 'cbr.mp3',
  description: '',
  duration: 1,
  encoding: 'utf-8',
  tjaName: 'chart.tja',
  audioName: 'cbr.mp3',
  tjaHash: 'c'.repeat(64),
  audioHash: 'd'.repeat(64),
  audioSize: audio.length,
  createdAt: '2026-09-15T00:00:00Z',
  categoryIds: ['variety'],
  titleTranslations: {},
  subtitleTranslations: {},
  difficulties: ['Hard', 'Oni', 'Edit'].map((course, blockIndex) => ({
    course,
    side: 'single',

    level: 5,

    maker: blockIndex === 1 ? 'B' : 'A',
  })),
}

test('upload maker defaults, individual edits, submitted per-difficulty mapping and song credits', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      json: {
        user: {
          id: 'owner',
          username: 'tester',
          nickname: '测试昵称',
          isAdmin: false,
          emailVerified: true,
        },
        csrfToken: 'csrf',
      },
    }),
  )
  await page.route(`**/api/v1/charts/${chart.id}*`, (route) => route.fulfill({ json: chart }))
  await page.route('**/api/v1/charts/*/tja', (route) => route.fulfill({ body: source }))
  await page.route('**/api/v1/charts/*/comments?*', (route) =>
    route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 0 } }),
  )
  await page.route('**/api/v1/me/notifications/unread', (route) =>
    route.fulfill({ json: { count: 0 } }),
  )
  await page.route('**/api/v1/charts/*/audio', (route) =>
    route.fulfill({ body: audio, contentType: 'audio/mpeg' }),
  )
  let submitted: unknown
  await page.route('**/api/v1/charts', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const form = await new Response(route.request().postDataBuffer()!, {
      headers: { 'Content-Type': route.request().headers()['content-type'] },
    }).formData()
    expect(form.get('demoStart')).toBe('0.1')
    expect(form.get('demoEnd')).toBe('0.3')
    expect(form.get('description')).toBe('Upload tabs test')
    submitted = JSON.parse(String(form.get('difficultyMakers')))
    await route.fulfill({ status: 201, json: chart })
  })
  await page.goto('/me/charts/publish')
  await page
    .getByLabel('选择 TJA 谱面')
    .setInputFiles({ name: 'chart.tja', mimeType: 'text/plain', buffer: Buffer.from(source) })
  await page
    .getByLabel('选择 OGG 或 MP3 音频')
    .setInputFiles({ name: 'cbr.mp3', mimeType: 'audio/mpeg', buffer: audio })
  await expect(page.getByRole('dialog', { name: '本地校验通过' })).toBeVisible()
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  await expect(page.getByRole('tablist', { name: '发布你的谱面' }).getByRole('tab')).toHaveText([
    '文件与封面',
    '谱面分类',
    '试听',
    '备注',
    '谱师名义',
  ])
  await page.getByRole('tab', { name: '试听', exact: true }).click()
  await expect(page.getByLabel('试听开始（秒）')).toHaveValue('0')
  await expect(page.getByLabel('试听结束（秒）')).toHaveValue('15')
  await page.getByLabel('试听结束（秒）').fill('0')
  await page.getByRole('button', { name: '发布谱面', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toContainText('终点须晚于起点')
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  await page.getByLabel('试听开始（秒）').fill('0.1')
  await page.getByLabel('试听结束（秒）').fill('0.3')
  await page.getByRole('button', { name: '播放试听', exact: true }).click()
  await expect
    .poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThanOrEqual(0.1)
  await expect
    .poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused))
    .toBe(true)
  await page.getByRole('tab', { name: '备注', exact: true }).click()
  await page.getByRole('textbox', { name: '备注', exact: true }).fill('Upload tabs test')
  await page.getByRole('tab', { name: '试听', exact: true }).click()
  await expect(page.getByLabel('试听结束（秒）')).toHaveValue('0.3')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '/tmp/upload-preview-tabs.png', fullPage: true })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('tab', { name: '谱师名义', exact: true }).click()
  await expect(page.getByRole('table')).toHaveCount(1)
  for (const [i, course] of ['Hard', 'Oni', 'Edit'].entries())
    await expect(page.getByLabel(`${course} 制作者`)).toHaveValue('A')
  await page.getByLabel('Oni 制作者').fill('B')
  await expect(page.locator('[data-testid="preview-panel"] dd').first()).toHaveText('A | B')
  await page.screenshot({ path: 'test-results/makers-upload-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({ path: 'test-results/makers-upload-mobile.png', fullPage: true })
  await page.getByRole('button', { name: '发布谱面', exact: true }).click()
  await expect(page).toHaveURL(`/charts/${chart.id}`)
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  expect(submitted).toEqual([
    { course: 'Hard', side: 'single', maker: 'A' },
    { course: 'Oni', side: 'single', maker: 'B' },
    { course: 'Edit', side: 'single', maker: 'A' },
  ])
  await expect(page.locator('[data-testid="detail-facts"]')).toContainText('A | B')
  // On a phone the chart sits behind its own section tab.
  await page.getByRole('tab', { name: '谱面', exact: true }).click()
  for (const [course, name] of [
    ['Hard', '困难'],
    ['Edit', '里谱'],
  ]) {
    await page.getByRole('tab', { name: `${name} 5 星`, exact: true }).click()
    await expect(page.locator('canvas')).toHaveAttribute('aria-label', `${course} 难度交互谱面预览`)
  }
  await page.screenshot({ path: 'test-results/makers-detail-mobile.png', fullPage: true })
  expect(errors).toEqual([])
})
