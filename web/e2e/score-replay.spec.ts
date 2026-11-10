import { test, expect } from '@playwright/test'
import type { Chart } from '../src/api/types'

// The labels below are the Chinese interface's.
test.use({ locale: 'zh-CN' })

// A recorded play opened from the leaderboard, and by a link (?replay=). The player is a stub that
// answers as the Unity build does; the real replay is tested in OurTaikoView_Web.
const source = `TITLE:Replay test
BPM:120
WAVE:test.ogg
COURSE:Oni
LEVEL:1
#START
1111,
#END
COURSE:Hard
LEVEL:1
#START
1111,
#END`
const chart: Chart = {
  id: 'replay-test',
  ownerId: 'fixture',
  uploader: 'tester',
  title: 'Replay test',
  subtitle: '',
  maker: 'tester',
  bpm: 120,
  offset: 0,
  demoStart: 0,
  wave: 'test.ogg',
  description: '',
  createdAt: '2026-11-10T00:00:00Z',
  duration: 4,
  encoding: 'utf-8',
  tjaName: 'test.tja',
  audioName: 'test.ogg',
  tjaHash: 'a'.repeat(64),
  audioHash: 'b'.repeat(64),
  audioSize: 100,
  titleTranslations: {},
  subtitleTranslations: {},
  categoryIds: [],
  difficulties: [
    { id: 11, course: 'Hard', side: 'single', level: 1, maker: '' },
    { id: 12, course: 'Oni', side: 'single', level: 1, maker: '' },
  ],
}
const recording = {
  version: 2,
  audio_offset_ms: 0,
  visual_offset_ms: 0,
  inputs: [
    [0, 1],
    [500, 2],
  ],
  options: { speed: 10, inverse: false, display: false, random: 0, flipped: [] },
}
const play = (id: string, extra: object = {}) => ({
  id,
  userId: 'u1',
  songId: 'replay-test',
  difficultyId: 11,
  course: 'Hard',
  side: 'single',
  good: 3,
  ok: 1,
  bad: 0,
  score: 4000,
  drumroll: 0,
  max_combo: 4,
  ClearStatus: 1,
  isLatest: true,
  submittedAt: '2026-11-10T01:00:00Z',
  hasReplay: true,
  ...extra,
})
const stub = `<!doctype html><script>
const emit = (type, requestId, payload) => parent.postMessage({channel:'ourtaiko-view',type,requestId,payload}, '*');
window.addEventListener('message', event => {
  const data = event.data;
  if (data?.channel !== 'ourtaiko-view' || data.type !== 'load') return;
  const { audioBytes, ...payload } = data.payload;
  parent.postMessage({ channel: 'replay-stub', payload }, '*');
  emit('loaded', data.requestId, {});
  if (payload.replay) setTimeout(() => emit('finished', data.requestId, { replay: RESULT }), 50);
});
emit('ready');
</script>`

async function open(page: import('@playwright/test').Page, result: object, path: string) {
  const cdn = 'https://distrib.ourtaiko.org'
  await page.route(`${cdn}/player-build.json`, (route) =>
    route.fulfill({
      json: { path: '/player/eeeeeeeeeeeeeeee/index.html' },
      headers: { 'Access-Control-Allow-Origin': '*' },
    }),
  )
  await page.route(`${cdn}/player/eeeeeeeeeeeeeeee/**`, (route) =>
    route.fulfill({
      body: stub.replace('RESULT', JSON.stringify(result)),
      contentType: 'text/html',
    }),
  )
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path === '/api/v1/me') return route.fulfill({ json: { user: null, csrfToken: '' } })
    if (path === '/api/v1/categories') return route.fulfill({ json: { items: [] } })
    if (path.endsWith('/tja')) return route.fulfill({ body: source })
    if (path.endsWith('/audio'))
      return route.fulfill({ body: Buffer.from('OggS stub'), contentType: 'audio/ogg' })
    if (path === '/api/v1/charts/replay-test') return route.fulfill({ json: chart })
    if (path === '/api/v1/charts/replay-test/leaderboard')
      return route.fulfill({
        json: {
          songId: 'replay-test',
          difficultyId: Number(url.searchParams.get('difficultyId')) || 12,
          course: 'Hard',
          side: 'single',
          items:
            url.searchParams.get('difficultyId') === '11'
              ? [
                  { ...play('s1'), nickname: 'Alice', rank: 1 },
                  { ...play('s2', { hasReplay: false, score: 3000 }), nickname: 'Bob', rank: 2 },
                ]
              : [],
          total: url.searchParams.get('difficultyId') === '11' ? 2 : 0,
          page: 1,
          pageSize: 20,
        },
      })
    if (path === '/api/v1/scores/s1/replay')
      return route.fulfill({ json: { score: play('s1'), nickname: 'Alice', replay: recording } })
    if (path === '/api/v1/scores/old/replay')
      return route.fulfill({
        json: { score: play('old', { isLatest: false }), nickname: 'Alice', replay: recording },
      })
    if (path.startsWith('/api/v1/scores/'))
      return route.fulfill({
        status: 404,
        json: { code: 'REPLAY_NOT_FOUND', message: '这条成绩没有回放' },
      })
    return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } })
  })
  await page.addInitScript(() => {
    const w = window as unknown as { loads: unknown[] }
    w.loads = []
    window.addEventListener('message', (event) => {
      if (event.data?.channel === 'replay-stub') w.loads.push(event.data.payload)
    })
  })
  await page.goto(path)
}
const loads = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { loads: Record<string, unknown>[] }).loads)
const same = {
  score: 4000,
  good: 3,
  ok: 1,
  bad: 0,
  drumroll: 0,
  maxCombo: 4,
  hits: 4,
  early: 1,
  late: 2,
  meanMs: 3.5,
  deviationMs: 12.25,
}

test('a leaderboard play with a recording opens in the player as a replay', async ({ page }) => {
  await open(page, same, '/charts/replay-test')
  await page.getByRole('tab', { name: '排行榜', exact: true }).first().click()
  await page.getByRole('tab', { name: /困难/ }).first().click()
  await expect(page.getByRole('button', { name: '观看 Alice 的回放' })).toBeVisible()
  await expect(page.getByRole('button', { name: '观看 Bob 的回放' })).toHaveCount(0)
  await page.getByRole('button', { name: '观看 Alice 的回放' }).click()
  await expect(page.getByTestId('replay-heading')).toHaveText('回放：Alice · 4,000')
  await expect.poll(() => loads(page)).toHaveLength(1)
  const [load] = await loads(page)
  expect(load).toMatchObject({ practice: true, autoPlay: false, replay: true, course: 'Hard' })
  expect(JSON.parse(load.replayData as string)).toEqual(recording)
  const summary = page.getByTestId('replay-summary')
  await expect(summary).toContainText('平均偏差')
  await expect(summary).toContainText('+3.5 毫秒')
  await expect(summary).toContainText('12.3 毫秒')
  await expect(summary.getByRole('alert')).toHaveCount(0)
  // Another mode closes the replay.
  await page.getByRole('button', { name: '观看谱面', exact: true }).click()
  await expect(page.getByTestId('replay-heading')).toHaveCount(0)
  await expect.poll(() => loads(page)).toHaveLength(2)
  expect((await loads(page))[1]).toMatchObject({ autoPlay: true, replay: false })
  expect((await loads(page))[1]).not.toHaveProperty('replayData')
})

test('a link opens the replay on its block and says when the result differs', async ({ page }) => {
  await open(page, { ...same, score: 3990, good: 2, ok: 2 }, '/charts/replay-test?replay=s1')
  await expect(page.getByTestId('replay-heading')).toHaveText('回放：Alice · 4,000')
  await expect.poll(() => loads(page)).toHaveLength(1)
  expect((await loads(page))[0]).toMatchObject({ replay: true, course: 'Hard' })
  await expect(page.getByTestId('replay-summary').getByRole('alert')).toBeVisible()
  await page.getByRole('button', { name: '关闭播放器', exact: true }).click()
  await expect(page).not.toHaveURL(/replay=/)
})

test('a recording of replaced files is not shown', async ({ page }) => {
  await open(page, same, '/charts/replay-test?replay=old')
  await expect(page.getByText('无法播放这条回放', { exact: false })).toBeVisible()
  await expect(page.getByTestId('replay-heading')).toHaveCount(0)
})
