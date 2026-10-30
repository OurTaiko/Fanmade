import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Chart } from '../src/api/types'

// The labels below are the Chinese interface's.
test.use({ locale: 'zh-CN' })

// The chart's background movie in the real Unity player: the page downloads /movie with the
// audio, transfers both, and the player shows it behind the lanes on the song clock.
const source = `TITLE:Embedded movie test
BPM:120
WAVE:test.wav
MOVIEOFFSET:1
COURSE:Oni
LEVEL:1
#START
1000,
1000,
1000,
1000,
1000,
1000,
#END`
const chart: Chart = {
  id: 'movie-test',
  ownerId: 'fixture',
  uploader: 'tester',
  title: 'Embedded movie test',
  subtitle: '',
  maker: 'tester',
  bpm: 120,
  offset: 0,
  demoStart: 0,
  wave: 'test.wav',
  description: '',
  createdAt: '2026-10-29T00:00:00Z',
  duration: 14,
  encoding: 'utf-8',
  tjaName: 'test.tja',
  audioName: 'test.wav',
  tjaHash: 'a'.repeat(64),
  audioHash: 'b'.repeat(64),
  audioSize: 100,
  movieHash: 'c'.repeat(64),
  movieSize: 100,
  titleTranslations: {},
  subtitleTranslations: {},
  categoryIds: [],
  difficulties: [{ course: 'Oni', side: 'single', level: 1, maker: '' }],
}
function wav(seconds: number) {
  const rate = 22050,
    samples = rate * seconds,
    data = Buffer.alloc(44 + samples * 2)
  data.write('RIFF', 0)
  data.writeUInt32LE(36 + samples * 2, 4)
  data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(rate, 24)
  data.writeUInt32LE(rate * 2, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36)
  data.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++)
    data.writeInt16LE(Math.round(Math.sin((i / rate) * 440 * Math.PI * 2) * 1200), 44 + i * 2)
  return data
}

test('real Unity player: background movie follows the song', async ({ page }) => {
  const buildDir = process.env.PLAYER_TEST_BUILD_DIR
  test.skip(!buildDir, 'PLAYER_TEST_BUILD_DIR is not set')
  test.setTimeout(180000)
  page.setDefaultTimeout(15000)
  const cdn = 'https://distrib.ourtaiko.org'
  const fixturePath = '/player/dddddddddddddddd/index.html'
  await page.route(`${cdn}/player-build.json`, (route) =>
    route.fulfill({ json: { path: fixturePath }, headers: { 'Access-Control-Allow-Origin': '*' } }),
  )
  await page.route(`${cdn}/player/dddddddddddddddd/**`, (route) => {
    const name = new URL(route.request().url()).pathname.split('/').slice(3).join('/')
    const contentType = name.endsWith('.html')
      ? 'text/html'
      : name.endsWith('.js')
        ? 'application/javascript'
        : 'application/octet-stream'
    return route.fulfill({ body: readFileSync(resolve(buildDir!, name)), contentType })
  })
  const movieRequests: string[] = []
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.endsWith('/movie')) movieRequests.push(r.frame().url())
  })
  page.on('console', (message) => {
    if (message.type() === 'error') console.log('browser:', message.text())
  })
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/me') return route.fulfill({ json: { user: null, csrfToken: '' } })
    if (path === '/api/v1/categories') return route.fulfill({ json: { items: [] } })
    if (path.endsWith('/tja')) return route.fulfill({ body: source })
    if (path.endsWith('/audio')) return route.fulfill({ body: wav(16), contentType: 'audio/wav' })
    if (path.endsWith('/movie'))
      return route.fulfill({
        body: readFileSync(new URL('./fixtures/embedded-movie.mp4', import.meta.url)),
        contentType: 'video/mp4',
      })
    if (path === '/api/v1/charts/movie-test') return route.fulfill({ json: chart })
    return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } })
  })
  await page.goto('/charts/movie-test')
  await page.getByRole('tab', { name: '谱面预览', exact: true }).click()
  await page.getByRole('button', { name: '观看谱面', exact: true }).click()
  await page.locator('iframe').scrollIntoViewIfNeeded()
  const frame = page.frameLocator('iframe')
  await expect(frame.locator('#start')).toBeVisible({ timeout: 150000 })
  expect(movieRequests).toHaveLength(1)
  expect(movieRequests[0]).not.toContain('/player/') // the page downloads it, not the player
  const state = () =>
    page.evaluate(async () => {
      const iframe = document.querySelector('iframe')!
      const requestId = crypto.randomUUID()
      return await new Promise<Record<string, number | boolean | string>>((done, fail) => {
        const timeout = setTimeout(() => fail(new Error('state timeout')), 5000)
        window.addEventListener('message', function receive(event: MessageEvent) {
          if (event.source !== iframe.contentWindow || event.data?.requestId !== requestId) return
          clearTimeout(timeout)
          window.removeEventListener('message', receive)
          done(event.data.payload)
        })
        iframe.contentWindow!.postMessage(
          { channel: 'ourtaiko-view', type: 'getState', requestId },
          new URL(iframe.src).origin,
        )
      })
    })
  // Before MOVIEOFFSET the screen is black: no frame shown yet.
  expect((await state()).movie).toBe(false)
  await frame.locator('#start').click()
  await expect.poll(async () => (await state()).stage).toBe('Measure')
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('f')
    await page.waitForTimeout(80)
  }
  await expect.poll(async () => Number((await state()).time), { timeout: 20000 }).toBeGreaterThan(4)
  const playing = await state()
  expect(playing.movie).toBe(true)
  expect(Math.abs(Number(playing.moviePosition) - (Number(playing.time) - 1))).toBeLessThan(0.25)
  await page.locator('iframe').screenshot({ path: 'test-results/embedded-movie.png' })
})
