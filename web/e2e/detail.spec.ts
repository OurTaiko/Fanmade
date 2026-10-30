import { selectValue } from './ui-helpers'
import { expect, test } from '@playwright/test'
import type { Chart } from '../src/api/types'

test('real ESE preview, default Oni, zoom, difficulty switching and public leaderboard', async ({
  page,
  request,
}) => {
  const list = await (await request.get('/api/v1/charts')).json()
  const chart: Chart = list.items.find((c: Chart) => c.title === 'Happy Synthesizer')
  expect(chart).toBeTruthy()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  let files = 0
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.endsWith('/tja')) files++
  })
  await page.goto(`/charts/${chart.id}`)
  await expect(page.getByRole('tab', { name: '谱面图片', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByLabel('选择难度', { exact: true })).toHaveAttribute('data-value', 'Oni')
  const canvas = page.locator('canvas')
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.height)).toBeGreaterThan(300)
  expect(
    await canvas.evaluate((c: HTMLCanvasElement) => {
      const values = c.getContext('2d')!.getImageData(0, 0, c.width, Math.min(c.height, 200)).data
      const colors = new Set<string>()
      for (let i = 0; i < values.length; i += 16)
        colors.add(`${values[i]},${values[i + 1]},${values[i + 2]}`)
      return colors.size
    }),
  ).toBeGreaterThan(10)
  const fetched = files
  await page.getByRole('button', { name: '放大谱面', exact: true }).click()
  await expect(page.getByLabel('每行拍数')).toHaveAttribute('data-value', '12')
  await selectValue(page, '选择难度', 'Edit')
  await expect(canvas).toHaveAttribute('aria-label', 'Edit 难度交互谱面预览')
  await selectValue(page, '选择难度', 'Oni')
  await page.getByRole('tab', { name: '排行榜', exact: true }).click()
  await expect(page.getByText('个人最高分 · 同分并列')).toBeVisible()
  await page.getByRole('tab', { name: '谱面图片', exact: true }).click()
  await expect(canvas).toBeVisible()
  expect(files).toBe(fetched)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  // Phones open on the introduction; the chart is one page tab away.
  await page.getByRole('tab', { name: '谱面', exact: true }).click()
  await expect(page.getByLabel('每行拍数')).toHaveAttribute('data-value', '4')
  await page.locator('[data-testid="chart-activity"]').scrollIntoViewIfNeeded()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({ path: 'test-results/detail-mobile.png' })
  expect(errors).toEqual([])
})

test('fallback Edit, branching and click inspection; leaderboard pagination and request errors', async ({
  page,
  request,
}) => {
  const list = await (await request.get('/api/v1/charts')).json()
  const base: Chart = list.items[0]
  const chart: Chart = {
    ...base,
    title: 'Preview test',
    difficulties: [
      {
        course: 'Hard',
        level: 5,

        maker: '',
      },
      {
        course: 'Edit',
        level: 8,

        maker: '',
      },
    ],
  }
  const tja = `TITLE:Preview test
BPM:150
COURSE:4
LEVEL:8
#START
1111,
#BRANCHSTART p,50,80
#N
1111,
#E
2222,
#M
1212,
#BRANCHEND
#END
COURSE:2
LEVEL:5
#START
2222,
#END`
  await page.route(`**/api/v1/charts/${chart.id}*`, (route) => route.fulfill({ json: chart }))
  let failTja = true
  await page.route('**/api/v1/charts/*/tja', (route) => {
    return failTja
      ? route.fulfill({ status: 503, body: 'unavailable' })
      : route.fulfill({ body: tja })
  })
  let failBoard = true
  await page.route('**/leaderboard?*', (route) => {
    if (failBoard) return route.fulfill({ status: 503, json: { message: '排行榜暂时不可用' } })
    const query = new URL(route.request().url()).searchParams
    const pageNumber = Number(query.get('page'))
    return route.fulfill({
      json: {
        songId: chart.id,
        difficulty: query.get('difficulty'),
        supported: true,
        total: 21,
        page: pageNumber,
        pageSize: 20,
        items: Array.from({ length: pageNumber === 1 ? 20 : 1 }, (_, i) => ({
          id: `entry${pageNumber}_${i}`,
          userId: 'public-user',
          nickname: `player${(pageNumber - 1) * 20 + i}`,
          rank: (pageNumber - 1) * 20 + i + 1,
          score: 900000,
          good: 300,
          ok: 2,
          bad: 1,
          drumroll: 55,
          submittedAt: '2026-09-13T12:00:00Z',
        })),
      },
    })
  })
  await page.goto(`/charts/${chart.id}`)
  await expect(page.getByRole('alertdialog')).toContainText('HTTP 503')
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  await expect(page.getByLabel('选择难度', { exact: true })).toHaveAttribute('data-value', 'Edit')
  failTja = false
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  const canvas = page.locator('canvas')
  await expect(canvas).toBeVisible()
  await selectValue(page, '选择分支', 'master')
  await expect(page.getByLabel('选择分支')).toHaveAttribute('data-value', 'master')
  await selectValue(page, '选择分支', 'all')
  // Use the renderer's layout API to locate a note, then trigger a real pointer click.
  const position = await page.evaluate(async (text) => {
    const adapterPath = '/src/preview-tja.ts'
    const hitPath = '/TJARenderer/src/hit-testing.ts'
    const primitivesPath = '/TJARenderer/src/primitives.ts'
    const [{ parsePreviewTja }, { getNotePosition }, { DEFAULT_RENDER_OPTIONS }] =
      await Promise.all([import(adapterPath), import(hitPath), import(primitivesPath)])
    return getNotePosition(
      parsePreviewTja(text)[0],
      document.querySelector('canvas'),
      { ...DEFAULT_RENDER_OPTIONS, beatsPerLine: 16, showAllBranches: true },
      0,
      0,
    )
  }, tja)
  expect(position).toBeTruthy()
  await canvas.click({ position })
  await expect(page.locator('[data-testid="preview-note-info"]')).toContainText('150')
  await expect(page.locator('[data-testid="preview-note-info"]')).not.toContainText('点击音符查看')
  await page.getByRole('tab', { name: '排行榜', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toContainText('排行榜暂时不可用')
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  failBoard = false
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByRole('cell', { name: '900,000', exact: true })).toHaveCount(20)
  await page.getByRole('button', { name: '下一页' }).click()
  await expect(page.getByRole('rowheader', { name: 'player20', exact: true })).toBeVisible()
  await selectValue(page, '选择难度', 'Hard')
  await expect(page.getByText('第 1 / 2 页')).toBeVisible()
  await page.getByRole('tab', { name: '排行榜', exact: true }).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('tab', { name: '谱面图片', exact: true })).toBeFocused()
})

test('real DOUBLE chart keeps P1 and P2 separate and has no leaderboard', async ({
  page,
  request,
}) => {
  const list = await (await request.get('/api/v1/charts')).json()
  const chart: Chart = list.items.find((c: Chart) => c.title === 'Aiai')
  await page.goto(`/charts/${chart.id}`)
  const side = page.getByLabel('谱面声部', { exact: true })
  await expect(side).toHaveAttribute('data-value', '0')
  await selectValue(page, '谱面声部', '1')
  await expect(side).toHaveAttribute('data-value', '1')
  await expect(page.locator('canvas')).toBeVisible()
  await page.getByRole('tab', { name: '排行榜', exact: true }).click()
  await expect(page.getByRole('heading', { name: '此难度为 DOUBLE 谱面' })).toBeVisible()
})
