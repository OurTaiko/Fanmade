import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

test('real Unity: native Ogg failure retries software once without another audio download', async ({
  page,
}) => {
  const build = process.env.PLAYER_TEST_BUILD_DIR
  test.skip(!build, 'Requires a newly built Web player with software decoding')
  test.setTimeout(180000)
  const cdn = 'https://d2mguycu233w0q.cloudfront.net'
  const path = '/player/cccccccccccccccc/'
  let audioDownloads = 0
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    const w = window as unknown as {
      events: Array<{ type: string; requestId: string; payload?: { code?: string; Good?: number } }>
      modes: string[]
    }
    w.events = []
    w.modes = []
    window.addEventListener('message', (event) => {
      if (event.data?.channel !== 'ourtaiko-view') return
      w.events.push(event.data)
      if (event.data.type === 'load') w.modes.push(event.data.payload.audioDecode)
    })
    const original = AudioContext.prototype.decodeAudioData
    AudioContext.prototype.decodeAudioData = function (bytes, success, failure) {
      const head = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength))
      if (head[0] === 79 && head[1] === 103 && head[2] === 103 && head[3] === 83) {
        const error = new DOMException('Simulated iOS 18.3 Ogg rejection', 'EncodingError')
        failure?.(error)
        return Promise.reject(error)
      }
      return original.call(this, bytes, success, failure)
    }
  })
  await page.route(`${cdn}/player-build.json`, (route) =>
    route.fulfill({
      json: { path: path + 'index.html' },
      headers: { 'Access-Control-Allow-Origin': '*' },
    }),
  )
  await page.route(`${cdn}${path}**`, (route) => {
    const name = new URL(route.request().url()).pathname.slice(path.length)
    return route.fulfill({
      body: readFileSync(resolve(build!, name)),
      contentType: name.endsWith('.html')
        ? 'text/html'
        : name.endsWith('.js')
          ? 'application/javascript'
          : 'application/octet-stream',
    })
  })
  const source =
    'TITLE:Software decode test\nBPM:120\nWAVE:test.ogg\nOFFSET:-1\nCOURSE:Oni\nLEVEL:1\n#START\n1111,\n2222,\n#END'
  await page.route('**/api/v1/**', (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === '/api/v1/me') return route.fulfill({ json: { user: null, csrfToken: '' } })
    if (pathname === '/api/v1/categories') return route.fulfill({ json: { items: [] } })
    if (pathname.endsWith('/tja')) return route.fulfill({ body: source })
    if (pathname.endsWith('/audio')) {
      // The chart page also has an independent <audio preload=metadata> preview.
      if (route.request().resourceType() === 'fetch') audioDownloads++
      return route.fulfill({
        body: readFileSync(resolve('e2e/fixtures/embedded-tone.ogg')),
        contentType: 'audio/ogg',
      })
    }
    if (pathname === '/api/v1/charts/view-test')
      return route.fulfill({
        json: {
          id: 'view-test',
          ownerId: 'fixture',
          uploader: 'tester',
          title: 'Software decode test',
          subtitle: '',
          maker: '',
          bpm: 120,
          offset: -1,
          demoStart: 0,
          wave: 'test.ogg',
          description: '',
          createdAt: '2026-10-09T00:00:00Z',
          duration: 6,
          encoding: 'utf-8',
          tjaName: 'test.tja',
          audioName: 'test.ogg',
          tjaHash: 'a'.repeat(64),
          audioHash: 'b'.repeat(64),
          audioSize: 100,
          titleTranslations: {},
          subtitleTranslations: {},
          categoryIds: [],
          difficulties: [{ course: 'Oni', level: 1, maker: '', branching: false }],
        },
      })
    return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } })
  })
  await page.goto('/charts/view-test')
  await page.getByRole('tab', { name: '谱面预览', exact: true }).click()
  await page.getByRole('button', { name: '观看谱面', exact: true }).click()
  await page.locator('iframe').scrollIntoViewIfNeeded()
  const frame = page.frameLocator('iframe')
  await expect(frame.locator('#start')).toBeVisible({ timeout: 120000 })
  expect(audioDownloads).toBe(1)
  const inner = page.frames().find((f) => f.url().startsWith(cdn + path))!
  expect(await inner.evaluate('modes')).toEqual(['native', 'software'])
  expect(
    await page.evaluate("events.filter(e => e.type === 'error').map(e => e.payload.code)"),
  ).toEqual(['AUDIO_DECODE_FAILED'])
  await frame.locator('#start').click()
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('f')
    await page.waitForTimeout(100)
  }
  await page.waitForFunction("events.some(e => e.type === 'finished')", undefined, {
    timeout: 30000,
  })
  expect(await page.evaluate("events.find(e => e.type === 'finished').payload.Good")).toBe(8)
  expect(errors).toEqual([])
  await page.screenshot({ path: 'test-results/embedded-software-decoding.png' })
  await page.getByRole('button', { name: /关闭播放器|Close player/ }).click()
  await expect(page.locator('iframe')).toHaveCount(0)
})
