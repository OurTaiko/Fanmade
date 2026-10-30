import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Chart } from '../src/api/types'

// Deterministic chart with real OGG and WAV decoding: no production score writes.
const source = `TITLE:Embedded player test
BPM:120
WAVE:test.ogg
OFFSET:-1
COURSE:Oni
LEVEL:1
#START
1111,
2222,
#END
COURSE:4
LEVEL:2
#START
#BRANCHSTART s,100,200
#N
1000,
#E
1100,
#M
1111,
#BRANCHEND
#BRANCHSTART s,2147483646,2147483647
#N
1000,
#BRANCHEND
#END`
const chart: Chart = {
  id: 'view-test',
  ownerId: 'fixture',
  uploader: 'tester',
  title: 'Embedded player test',
  subtitle: '',
  maker: 'tester',
  bpm: 120,
  offset: -1,
  demoStart: 0,
  wave: 'test.ogg',
  description: '',
  createdAt: '2026-10-05T00:00:00Z',
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
  difficulties: [
    { course: 'Oni', side: 'single', level: 1, maker: '' },
    { course: 'Edit', side: 'single', level: 2, maker: '' },
  ],
}
function wav() {
  const rate = 22050,
    samples = rate * 6,
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
test('real Unity player: auto, finish reset, practice, course change and unload', async ({
  page,
}) => {
  test.setTimeout(180000)
  page.setDefaultTimeout(15000)
  const buildDir = process.env.PLAYER_TEST_BUILD_DIR
  test.skip(!buildDir, 'PLAYER_TEST_BUILD_DIR is not set')
  const cdn = 'https://distrib.ourtaiko.org'
  const fixturePath = '/player/cccccccccccccccc/index.html'
  if (buildDir) {
    await page.route(`${cdn}/player-build.json`, (route) =>
      route.fulfill({
        json: { path: fixturePath },
        headers: { 'Access-Control-Allow-Origin': '*' },
      }),
    )
    await page.route(`${cdn}/player/cccccccccccccccc/**`, (route) => {
      const name = new URL(route.request().url()).pathname.split('/').slice(3).join('/')
      const contentType = name.endsWith('.html')
        ? 'text/html'
        : name.endsWith('.js')
          ? 'application/javascript'
          : 'application/octet-stream'
      return route.fulfill({ body: readFileSync(resolve(buildDir, name)), contentType })
    })
  }
  const audioFrames: string[] = []
  const errors: string[] = []
  const writes: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (message) => {
    if (message.type() === 'error') console.log('browser:', message.text())
  })
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.endsWith('/audio')) audioFrames.push(r.frame().url())
    if (r.method() === 'POST' && r.url().includes('/api/')) writes.push(r.url())
  })
  await page.addInitScript(() => {
    const state = window as unknown as { playerEvents: Array<Record<string, unknown>> }
    state.playerEvents = []
    window.addEventListener('message', (event) => {
      if (event.data?.channel === 'ourtaiko-view') state.playerEvents.push(event.data)
    })
  })
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/me') return route.fulfill({ json: { user: null, csrfToken: '' } })
    if (path === '/api/v1/categories') return route.fulfill({ json: { items: [] } })
    if (path.endsWith('/tja')) return route.fulfill({ body: source })
    if (path.endsWith('/audio'))
      return route.fulfill({
        body: readFileSync(new URL('./fixtures/embedded-tone.ogg', import.meta.url)),
        contentType: 'audio/ogg',
      })
    if (path === '/api/v1/charts/view-test') return route.fulfill({ json: chart })
    return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } })
  })
  await page.route('**/fixture-audio.wav', (route) =>
    route.fulfill({ body: wav(), contentType: 'audio/wav' }),
  )
  await page.goto('/charts/view-test')
  await expect(page.getByRole('tab', { name: '谱面图片', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.getByRole('tab', { name: '谱面预览', exact: true }).click()
  await page.getByRole('button', { name: '观看谱面', exact: true }).click()
  // Keep Unity's frame-driven loading active; offscreen iframes may be throttled.
  await page.locator('iframe').scrollIntoViewIfNeeded()
  const frame = page.frameLocator('iframe')
  const playerBuild = buildDir
    ? { path: fixturePath }
    : await (
        await page.request.get(process.env.PLAYER_TEST_MANIFEST_URL || `${cdn}/player-build.json`)
      ).json()
  await expect
    .poll(async () => {
      const src = await page.locator('iframe').getAttribute('src')
      return src ? new URL(src).pathname : ''
    })
    .toBe(playerBuild.path)
  console.log('Testing player:', playerBuild.path)
  const loadedCount = () =>
    page.evaluate(
      () =>
        (window as unknown as { playerEvents: Array<{ type: string }> }).playerEvents.filter(
          (e) => e.type === 'loaded',
        ).length,
    )
  const changeAndLoad = async (action: () => Promise<unknown>) => {
    const previous = await loadedCount()
    await action()
    await expect.poll(loadedCount, { timeout: 30000 }).toBe(previous + 1)
    await expect(frame.locator('#start')).toBeVisible()
  }

  await expect
    .poll(async () => frame.locator('#message').innerText(), { timeout: 150000 })
    .not.toContain('Loading player')
  await expect(frame.locator('#start')).toBeVisible({ timeout: 45000 })
  const state = async () => {
    return page.evaluate(async () => {
      const frame = document.querySelector('iframe')!
      const requestId = crypto.randomUUID()
      return await new Promise<Record<string, number | boolean | string>>((resolve, reject) => {
        const timeout = setTimeout(() => {
          window.removeEventListener('message', receive)
          reject(new Error('state timeout'))
        }, 5000)
        function receive(event: MessageEvent) {
          if (
            event.source === frame.contentWindow &&
            event.data?.type === 'state' &&
            event.data.requestId === requestId
          ) {
            clearTimeout(timeout)
            window.removeEventListener('message', receive)
            resolve(event.data.payload)
          }
        }
        window.addEventListener('message', receive)
        frame.contentWindow!.postMessage(
          { channel: 'ourtaiko-view', type: 'getState', requestId },
          new URL(document.querySelector('iframe')!.src).origin,
        )
      })
    })
  }
  const finishedCount = () =>
    page.evaluate(
      () =>
        (window as unknown as { playerEvents: Array<{ type: string }> }).playerEvents.filter(
          (e) => e.type === 'finished',
        ).length,
    )
  // Start only opens the in-game practice menu, as in OurTaikoPlay; don confirms each page.
  const openMenu = async (stage: string) => {
    await frame.locator('#start').click()
    await expect.poll(async () => (await state()).stage).toBe(stage)
    expect((await state()).paused).toBe(true)
  }
  const confirmPages = async (count: number) => {
    for (let i = 0; i < count; i++) {
      await page.keyboard.press('f')
      await page.waitForTimeout(80)
    }
  }
  // The drum volume slider posts setDrumVolume on every change; the player reports it back.
  expect((await state()).drumVolume).toBe(100)
  const drumVolume = page.getByRole('slider', { name: /鼓声音量|Drum volume/ })
  await drumVolume.focus()
  await page.keyboard.press('Home')
  await expect.poll(async () => (await state()).drumVolume).toBe(0)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await state()).drumVolume).toBe(2)
  await page.keyboard.press('End')
  await expect.poll(async () => (await state()).drumVolume).toBe(100)
  await openMenu('Measure')
  await confirmPages(2)
  await expect.poll(finishedCount, { timeout: 30000 }).toBe(1)
  await expect(page.getByText('播放结束，已回到第一小节并暂停。')).toBeVisible({ timeout: 30000 })
  const finished = await page.evaluate(() =>
    (
      window as unknown as {
        playerEvents: Array<{
          type: string
          payload: { Good: number; Bad: number; AutoPlay: boolean }
        }>
      }
    ).playerEvents.find((e) => e.type === 'finished'),
  )
  expect(finished?.payload.AutoPlay).toBe(true)
  expect(finished?.payload.Good).toBe(8)
  expect(finished?.payload.Bad).toBe(0)
  const ended = await state()
  expect(ended.paused).toBe(true)
  expect(ended.position).toBe(ended.first)
  expect(ended.good).toBe(0)
  await page.screenshot({ path: 'test-results/embedded-auto-finished.png' })
  await changeAndLoad(() => page.getByRole('button', { name: '练习', exact: true }).click())
  await expect(frame.locator('#start')).toBeVisible({ timeout: 30000 })
  await openMenu('Measure')
  await confirmPages(2)
  const preparing = await state()
  expect(Number(preparing.time)).toBeLessThan(Number(preparing.first) - 1.7)
  expect(preparing.bad).toBe(0)
  // Press on the four dons of the first measure, 0.5 s apart from the first bar, instead of
  // mashing: an early press inside the 不可 window takes the note and scores nothing.
  const clock = await state()
  const origin = Date.now() - Number(clock.time) * 1000
  for (let k = 0; k < 4; k++) {
    const wait = origin + (Number(clock.first) + k * 0.5) * 1000 - Date.now()
    if (wait > 0) await page.waitForTimeout(wait)
    await page.keyboard.press('f')
  }
  expect((await state()).autoPlay).toBe(false)
  expect(Number((await state()).score)).toBeGreaterThan(0)
  await page.keyboard.press('Space')
  await expect.poll(async () => (await state()).paused).toBe(true)
  await page.screenshot({ path: 'test-results/embedded-practice.png' })
  await page.evaluate(() => {
    const target = document.querySelector('iframe')!.contentWindow!
    for (const type of ['restart', 'start'])
      target.postMessage(
        { channel: 'ourtaiko-view', type },
        new URL(document.querySelector('iframe')!.src).origin,
      )
  })
  await page.waitForTimeout(1800)
  const canvas = frame.locator('canvas')
  const size = await canvas.boundingBox()
  expect(size).not.toBeNull()
  for (let i = 0; i < 12; i++) {
    await canvas.click({ position: { x: size!.width * 0.45, y: size!.height * 0.9 } })
    await page.waitForTimeout(40)
  }
  expect(Number((await state()).score)).toBeGreaterThan(0)

  console.log('manual input verified; changing course')
  await changeAndLoad(() => page.getByRole('tab', { name: /里谱/ }).click())
  await expect(frame.locator('#start')).toBeVisible({ timeout: 30000 })
  // The host no longer offers a branch control: the route is chosen on the in-game menu's first page.
  await expect(page.getByRole('combobox', { name: '选择分支' })).toHaveCount(0)
  await changeAndLoad(() => page.getByRole('button', { name: '观看谱面', exact: true }).click())
  await openMenu('Branch')
  for (const [route, notes] of [
    ['Normal', 2],
    ['Expert', 3],
    ['Master', 5],
  ] as const) {
    console.log('checking route', route)
    // Finishing returns to the branch page with the route kept, so each step is one ka.
    if (route !== 'Normal') await page.keyboard.press('k')
    await expect.poll(async () => (await state()).forcedBranch).toBe(route)
    expect((await state()).stage).toBe('Branch')
    const before = await finishedCount()
    await confirmPages(3)
    await expect.poll(finishedCount, { timeout: 30000 }).toBe(before + 1)
    await expect.poll(async () => (await state()).stage).toBe('Branch')
    const result = await page.evaluate(() => {
      const events = (
        window as unknown as { playerEvents: Array<{ type: string; payload: { Good: number } }> }
      ).playerEvents
      return events.filter((e) => e.type === 'finished').at(-1)?.payload
    })
    expect(result?.Good).toBe(notes)
  }
  await page.screenshot({ path: 'test-results/embedded-branches.png' })
  // Exercise both expression thresholds and the counters in the shipped WASM.
  const expressionChart = `TITLE:Expression thresholds
BPM:120
OFFSET:0
COURSE:Oni
LEVEL:1
BALLOON:5
#START
${'1'.repeat(49)},
01000000,
${'1'.repeat(100)},
0,
5008,
6008,
7008,
1,
#END`
  const beforeExpressions = await finishedCount()
  await page.evaluate(async (chartText) => {
    const audioBytes = await (await fetch('/fixture-audio.wav')).arrayBuffer()
    document.querySelector('iframe')!.contentWindow!.postMessage(
      {
        channel: 'ourtaiko-view',
        type: 'load',
        requestId: 'expression-check',
        payload: {
          chartText,
          audioBytes,
          audioType: 'wav',
          course: 'Oni',
          side: 'single',
          practice: true,
          autoPlay: true,
          replay: false,
        },
      },
      new URL(document.querySelector('iframe')!.src).origin,
      [audioBytes],
    )
  }, expressionChart)
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (
            window as unknown as { playerEvents: Array<{ type: string; requestId: string }> }
          ).playerEvents.some((e) => e.type === 'loaded' && e.requestId === 'expression-check'),
        ),
      { timeout: 30000 },
    )
    .toBe(true)
  await openMenu('Measure')
  await confirmPages(2)
  await expect.poll(async () => (await state()).good, { timeout: 15000 }).toBe(50)
  await expect.poll(async () => Number((await state()).time)).toBeGreaterThan(2.55)
  await page.screenshot({ path: 'test-results/embedded-expression-50.png' })
  await expect.poll(async () => (await state()).good, { timeout: 15000 }).toBe(150)
  await expect.poll(async () => Number((await state()).time)).toBeGreaterThan(6.3)
  await page.screenshot({ path: 'test-results/embedded-expression-150.png' })
  await expect.poll(finishedCount, { timeout: 30000 }).toBe(beforeExpressions + 1)
  const expressionResult = await page.evaluate(
    () =>
      (
        window as unknown as {
          playerEvents: Array<{
            type: string
            payload: { Good: number; Bad: number; Rolls: number }
          }>
        }
      ).playerEvents
        .filter((e) => e.type === 'finished')
        .at(-1)?.payload,
  )
  expect(expressionResult?.Good).toBe(151)
  expect(expressionResult?.Bad).toBe(0)
  expect(expressionResult?.Rolls).toBeGreaterThan(0)

  // Also exercise WAV through the same browser PCM decoder without reloading WASM.
  await page.evaluate(async (chartText) => {
    const audioBytes = await (await fetch('/fixture-audio.wav')).arrayBuffer()
    document.querySelector('iframe')!.contentWindow!.postMessage(
      {
        channel: 'ourtaiko-view',
        type: 'load',
        requestId: 'wav-check',
        payload: {
          chartText,
          audioBytes,
          audioType: 'wav',
          course: 'Oni',
          side: 'single',
          practice: true,
          autoPlay: false,
          replay: false,
        },
      },
      new URL(document.querySelector('iframe')!.src).origin,
      [audioBytes],
    )
  }, source)
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (
            window as unknown as { playerEvents: Array<{ type: string; requestId: string }> }
          ).playerEvents.some((e) => e.type === 'loaded' && e.requestId === 'wav-check'),
        ),
      { timeout: 30000 },
    )
    .toBe(true)
  expect((await state()).paused).toBe(true)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('tab', { name: '谱面', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.getByRole('tab', { name: '谱面图片', exact: true }).click()
  await expect(page.locator('iframe')).toHaveCount(0)
  expect(writes).toEqual([])
  expect(audioFrames.length).toBeGreaterThan(0)
  expect(audioFrames.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true)
  expect(errors).toEqual([])
})
