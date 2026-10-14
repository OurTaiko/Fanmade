import { expect, test } from '@playwright/test'

test.use({ reducedMotion: 'reduce' })

test('owner edits preview range while player keeps full audio source', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let chart = {
    id: 'preview-song',
    ownerId: 'owner',
    uploader: 'tester',
    title: 'Preview test',
    subtitle: '',
    titleTranslations: { en: 'Preview test' },
    subtitleTranslations: {},
    maker: 'A',
    bpm: 120,
    offset: 0,
    demoStart: 12,
    demoEnd: 27,
    previewPath: 'fanmade/production/previews/old/preview.ogg',
    wave: 'audio.ogg',
    description: '',
    createdAt: '2026-10-05T00:00:00Z',
    duration: 100,
    encoding: 'utf-8',
    tjaName: 'song.tja',
    audioName: 'audio.ogg',
    tjaHash: 'a'.repeat(64),
    audioHash: 'b'.repeat(64),
    audioSize: 100,
    categoryIds: [],
    difficulties: [{ course: 'Oni', level: 5, maker: 'A' }],
  }
  const patches: unknown[] = []
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/me'))
      return route.fulfill({
        json: {
          user: {
            id: 'owner',
            username: 'tester',
            nickname: 'tester',
            emailVerified: true,
            isAdmin: false,
          },
          csrfToken: 'csrf',
        },
      })
    if (path.endsWith('/categories')) return route.fulfill({ json: { items: [] } })
    if (path.endsWith('/tja'))
      return route.fulfill({
        body: 'TITLE:Preview test\nBPM:120\nCOURSE:Oni\nLEVEL:5\n#START\n1000,\n#END',
      })
    if (path.endsWith('/audio')) {
      // A real PCM source exercises browser playback, seeking and range stopping.
      const samples = 8000 * 100
      const wav = Buffer.alloc(44 + samples * 2)
      wav.write('RIFF', 0)
      wav.writeUInt32LE(wav.length - 8, 4)
      wav.write('WAVEfmt ', 8)
      wav.writeUInt32LE(16, 16)
      wav.writeUInt16LE(1, 20)
      wav.writeUInt16LE(1, 22)
      wav.writeUInt32LE(8000, 24)
      wav.writeUInt32LE(16000, 28)
      wav.writeUInt16LE(2, 32)
      wav.writeUInt16LE(16, 34)
      wav.write('data', 36)
      wav.writeUInt32LE(samples * 2, 40)
      const range = route
        .request()
        .headers()
        .range?.match(/^bytes=(\d+)-(\d*)$/)
      const start = range ? Number(range[1]) : 0
      const end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1
      return route.fulfill({
        status: range ? 206 : 200,
        contentType: 'audio/wav',
        headers: {
          'Accept-Ranges': 'bytes',
          ...(range ? { 'Content-Range': `bytes ${start}-${end}/${wav.length}` } : {}),
        },
        body: wav.subarray(start, end + 1),
      })
    }
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON()
      patches.push(patch)
      expect(route.request().headers()['x-csrf-token']).toBe('csrf')
      chart = { ...chart, ...patch, previewPath: 'fanmade/production/previews/new/preview.ogg' }
    }
    return route.fulfill({ json: chart })
  })
  await page.goto('/charts/preview-song')
  await page.getByRole('button', { name: '编辑信息', exact: true }).click()
  await page.getByRole('tab', { name: '试听', exact: true }).click()
  await expect(page.getByLabel('试听开始（秒）')).toHaveValue('12')
  await expect(page.getByLabel('试听结束（秒）')).toHaveValue('27')
  await page.getByLabel('试听结束（秒）').fill('10')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toContainText('终点须晚于起点')
  expect(patches).toHaveLength(0)
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  await page.getByRole('tab', { name: '谱面介绍', exact: true }).click()
  await page.getByRole('textbox', { name: '谱面介绍', exact: true }).fill('新的介绍')
  await page.getByRole('tab', { name: '谱师名义', exact: true }).click()
  await page.getByLabel('Oni ★5', { exact: true }).fill('New maker')
  await page.getByRole('tab', { name: '译名', exact: true }).click()
  await page.getByLabel('英文歌名', { exact: true }).fill('New title')
  await page.getByRole('tab', { name: '试听', exact: true }).click()
  await page.getByLabel('试听开始（秒）').fill('20.5')
  await page.getByLabel('试听结束（秒）').fill('21.2')
  const audio = page.locator('audio')
  await expect(page.getByRole('button', { name: '播放试听', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '播放试听', exact: true }).click()
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThanOrEqual(20.5)
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
  expect(await audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeCloseTo(21.2, 1)
  await page.getByLabel('试听结束（秒）').fill('36')
  await page.getByRole('button', { name: '播放试听', exact: true }).click()
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.paused)).toBe(false)
  expect(await audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeLessThan(22)
  await page.getByLabel('试听开始（秒）').fill('25')
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
  await page.getByRole('button', { name: '播放试听', exact: true }).click()
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThanOrEqual(25)
  await page.getByLabel('试听开始（秒）').fill('20.5')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect.poll(() => patches.length).toBe(1)
  expect(patches[0]).toEqual({
    demoStart: 20.5,
    demoEnd: 36,
    description: '新的介绍',
    difficultyMakers: [{ course: 'Oni', maker: 'New maker' }],
    titleTranslations: { en: 'New title' },
  })
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  await page.getByRole('button', { name: '试听', exact: true }).click()
  await expect(page.locator('audio')).toHaveAttribute(
    'src',
    /\/api\/v1\/charts\/preview-song\/audio$/,
  )
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '编辑信息', exact: true }).click()
  await page.getByRole('tab', { name: '试听', exact: true }).click()
  await expect(page.getByLabel('试听开始（秒）')).toHaveValue('20.5')
  await expect(page.getByLabel('试听结束（秒）')).toHaveValue('36')
  expect(errors).toEqual([])
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('tab', { name: '译名', exact: true })).toBeVisible()
  await page.screenshot({ path: '/tmp/fanmade-preview-editor.png', animations: 'disabled' })
})
