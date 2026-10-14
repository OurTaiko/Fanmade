import { expect, test } from '@playwright/test'

test('double chart sides select separate previews and leaderboards without block indexes', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const chart = {
    id: 'double-chart',
    ownerId: 'owner',
    uploader: 'tester',
    title: 'Double test',
    subtitle: '',
    titleTranslations: { en: 'Double test' },
    subtitleTranslations: {},
    maker: 'A | B',
    bpm: 120,
    offset: 0,
    demoStart: 0,
    wave: 'audio.ogg',
    description: '',
    createdAt: '2026-10-05T00:00:00Z',
    duration: 10,
    encoding: 'utf-8',
    tjaName: 'd.tja',
    audioName: 'audio.ogg',
    tjaHash: 'a'.repeat(64),
    audioHash: 'b'.repeat(64),
    audioSize: 10,
    categoryIds: [],
    difficulties: [
      { id: 11, course: 'Oni', side: 'p1', level: 9, maker: 'A', branching: false },
      { id: 12, course: 'Oni', side: 'p2', level: 8, maker: 'B', branching: false },
    ],
  }
  const source =
    'TITLE:Double test\nBPM:120\nCOURSE:Oni\nLEVEL:8\n#START P2\n2222,\n#END\nLEVEL:9\n#START P1\n1111,\n#END'
  const boards: string[] = []
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url()),
      p = url.pathname
    if (p.endsWith('/me')) return route.fulfill({ json: { user: null, csrfToken: '' } })
    if (p.endsWith('/categories')) return route.fulfill({ json: [] })
    if (p.endsWith('/tja')) return route.fulfill({ body: source })
    if (p.endsWith('/leaderboard')) {
      // Each block has its own leaderboard, asked for by the block's ID.
      const block = chart.difficulties.find(
        (d) => String(d.id) === url.searchParams.get('difficultyId'),
      )!
      const course = block.course + (block.side === 'p1' ? '_1p' : '_2p')
      boards.push(course)
      return route.fulfill({
        json: {
          songId: chart.id,
          difficultyId: block.id,
          course: block.course,
          side: block.side,
          supported: true,
          total: 1,
          page: 1,
          pageSize: 20,
          items: [
            {
              id: course,
              userId: 'player',
              nickname: course + ' player',
              rank: 1,
              score: 1000,
              good: 10,
              ok: 0,
              bad: 0,
              drumroll: 0,
              max_combo: 10,
              ClearStatus: 2,
              submittedAt: '2026-10-05T00:00:00Z',
            },
          ],
        },
      })
    }
    return route.fulfill({ json: chart })
  })
  await page.goto('/charts/double-chart')
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveAttribute('aria-label', 'Oni_1p 难度交互谱面预览')
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.height)).toBeGreaterThan(100)
  // P1 and P2 of one course are one double chart with a side switch.
  await expect(
    page.getByRole('tablist', { name: '选择难度', exact: true }).getByRole('tab'),
  ).toHaveText(['魔王 双打9/8'])
  const sides = page.getByRole('tablist', { name: '选择玩家侧', exact: true })
  await sides.getByRole('tab', { name: '2P 8 星', exact: true }).click()
  await expect(canvas).toHaveAttribute('aria-label', 'Oni_2p 难度交互谱面预览')
  await page.getByRole('tab', { name: '排行榜', exact: true }).click()
  await expect(page.getByText('Oni_2p player', { exact: true })).toBeVisible()
  await sides.getByRole('tab', { name: '1P 9 星', exact: true }).click()
  await expect(page.getByText('Oni_1p player', { exact: true })).toBeVisible()
  expect(boards).toContain('Oni_1p')
  expect(boards).toContain('Oni_2p')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  expect(errors).toEqual([])
})
