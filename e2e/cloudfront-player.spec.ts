import { test, expect, type Page } from '@playwright/test'

// Run against a production preview (pnpm build; pnpm preview): .env.production
// selects the remote manifest. CDN replies are fixtures, not production writes.
async function setupPlayer(page: Page) {
  const cdn = 'https://distrib.ourtaiko.org'
  const versions = ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb']
  let reads = 0
  const source = 'TITLE:CDN test\nBPM:120\nWAVE:test.ogg\nCOURSE:Oni\nLEVEL:1\n#START\n1000,\n#END'
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/me')) return route.fulfill({ json: { user: null, csrfToken: '' } })
    if (path.endsWith('/audio'))
      return route.fulfill({ body: Buffer.from([1, 2, 3, 4]), contentType: 'audio/ogg' })
    if (path.endsWith('/tja')) return route.fulfill({ body: source })
    if (path === '/api/v1/charts/cdn-test')
      return route.fulfill({
        json: {
          id: 'cdn-test',
          ownerId: 'fixture',
          uploader: 'tester',
          title: 'CDN test',
          subtitle: '',
          maker: 'tester',
          bpm: 120,
          offset: 0,
          demoStart: 0,
          wave: 'test.ogg',
          description: '',
          createdAt: '2026-10-09T00:00:00Z',
          duration: 2,
          tjaName: 'test.tja',
          audioName: 'test.ogg',
          tjaHash: 'a'.repeat(64),
          audioHash: 'b'.repeat(64),
          audioSize: 10,
          titleTranslations: {},
          subtitleTranslations: {},
          categoryIds: [],
          difficulties: [{ course: 'Oni', level: 1, maker: '' }],
        },
      })
    return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } })
  })
  await page.route(`${cdn}/player-build.json`, (route) =>
    route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
      json: { path: `/player/${versions[Math.min(reads++, 1)]}/index.html` },
    }),
  )
  await page.route(`${cdn}/player/**`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><p>CDN player fixture</p><script>
      const origin = new URLSearchParams(location.search).get('parentOrigin');
      addEventListener('message', event => {
        if (event.source !== parent || event.origin !== origin) return;
        const data = event.data;
        const type = data.type === 'hello' ? 'ready' : data.type === 'load' ? 'loaded' : null;
        if(data.type==='load'&&(!(data.payload.audioBytes instanceof ArrayBuffer)||data.payload.audioBytes.byteLength!==4||data.payload.audioUrl))throw new Error('Expected transferred audio bytes');
        if (type) parent.postMessage({channel:'ourtaiko-view',type,requestId:data.requestId,payload:{}},origin);
      });
    </script>`,
    }),
  )
  return () => reads
}

async function openChart(page: Page) {
  await page.goto('/charts/cdn-test')
  await page.getByRole('tab', { name: '谱面预览', exact: true }).click()
  const watch = page.getByRole('button', { name: '观看谱面', exact: true })
  return watch
}

test('reopening the player discovers a new CDN version without reloading the website', async ({
  page,
}) => {
  const reads = await setupPlayer(page)
  const watch = await openChart(page)
  const cdn = 'https://distrib.ourtaiko.org'
  const versions = ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb']
  await watch.click()
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    new RegExp(`${versions[0]}/index.html`),
  )
  await expect(watch).toBeEnabled()
  const first = new URL((await page.locator('iframe').getAttribute('src'))!)
  expect(first.origin).toBe(cdn)
  expect(first.searchParams.get('parentOrigin')).toBe(new URL(page.url()).origin)
  await page.getByRole('button', { name: /关闭播放器|Close player/ }).click()
  await expect(page.locator('iframe')).toHaveCount(0)
  await watch.click()
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    new RegExp(`${versions[1]}/index.html`),
  )
  await expect(watch).toBeEnabled()
  expect(reads()).toBe(2)
})

test('audio download failure can be retried', async ({ page }) => {
  await setupPlayer(page)
  let downloads = 0
  await page.route('**/api/v1/charts/cdn-test/audio', (route) => {
    if (route.request().resourceType() !== 'fetch') return route.fallback()
    downloads++
    return downloads === 1
      ? route.fulfill({ status: 503, body: 'unavailable' })
      : route.fulfill({ body: Buffer.from([1, 2, 3, 4]), contentType: 'audio/ogg' })
  })
  const watch = await openChart(page)
  await watch.click()
  await expect(page.locator('section[aria-label="谱面预览"]').getByRole('alert')).toContainText(
    'AUDIO_DOWNLOAD_FAILED',
  )
  await page
    .locator('section[aria-label="谱面预览"]')
    .getByRole('alert')
    .getByRole('button')
    .click()
  await expect(page.locator('section[aria-label="谱面预览"]').getByRole('alert')).toHaveCount(0)
  await expect(watch).toBeEnabled()
  expect(downloads).toBe(2)
})

test('closing cancels the audio download and reopening starts a fresh load', async ({ page }) => {
  await setupPlayer(page)
  let downloads = 0
  let release: () => void = () => {}
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/v1/charts/cdn-test/audio', async (route) => {
    if (route.request().resourceType() !== 'fetch') return route.fallback()
    downloads++
    if (downloads === 1) await pending
    await route
      .fulfill({ body: Buffer.from([1, 2, 3, 4]), contentType: 'audio/ogg' })
      .catch(() => {})
  })
  // Observe the host's actual AbortSignal, not the routing fixture's timing.
  await page.addInitScript(() => {
    const original = window.fetch
    ;(window as any).audioAborts = 0
    window.fetch = function (input, init) {
      if (String(input).endsWith('/audio'))
        init?.signal?.addEventListener('abort', () => {
          ;(window as any).audioAborts++
        })
      return original.call(this, input, init)
    }
  })
  const watch = await openChart(page)
  await watch.click()
  await expect.poll(() => downloads).toBe(1)
  await page.getByRole('button', { name: /关闭播放器|Close player/ }).click()
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as any).audioAborts)).toBe(1)
  release()
  await watch.click()
  await expect.poll(() => downloads).toBe(2)
  await expect(watch).toBeEnabled()
  await expect(page.locator('section[aria-label="谱面预览"]').getByRole('alert')).toHaveCount(0)
})
