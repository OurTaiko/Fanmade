import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test.use({ reducedMotion: 'reduce' })

const baseChart = {
  id: 'movie-song',
  ownerIds: ['owner'],
  uploader: 'tester',
  title: 'Movie test',
  subtitle: '',
  titleTranslations: { en: 'Movie test' },
  subtitleTranslations: {},
  maker: 'A',
  bpm: 120,
  offset: 0,
  demoStart: 12,
  demoEnd: 27,
  wave: 'audio.ogg',
  description: '',
  createdAt: '2026-11-03T00:00:00Z',
  duration: 100,
  encoding: 'utf-8',
  tjaName: 'song.tja',
  audioName: 'audio.ogg',
  audioHash: 'b'.repeat(64),
  audioSize: 100,
  movieOffset: 0.5,
  categoryIds: [],
  difficulties: [{ course: 'Oni', side: 'single', level: 5, maker: 'A' }],
}

type Sent = { method: string; path: string; prefer?: string; body: string }

async function mock(page: Page, chart: Record<string, unknown>) {
  const sent: Sent[] = []
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
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
      return route.fulfill({ body: 'TITLE:Movie test\nCOURSE:Oni\nLEVEL:5\n#START\n1000,\n#END' })
    if (path.endsWith('/audio') || (path.endsWith('/movie') && request.method() === 'GET'))
      return route.fulfill({ status: 404, json: { code: 'RESOURCE_NOT_FOUND' } })
    if (request.method() === 'PUT' && path.endsWith('/movie')) {
      expect(request.headers()['x-csrf-token']).toBe('csrf')
      sent.push({
        method: 'PUT',
        path,
        prefer: request.headers()['prefer'],
        body: request.postDataBuffer()?.toString('latin1') ?? '',
      })
      return route.fulfill({ status: 202, json: { status: 'processing' } })
    }
    if (request.method() === 'PATCH') {
      const patch = request.postDataJSON()
      sent.push({ method: 'PATCH', path, body: JSON.stringify(patch) })
      chart = { ...chart, ...patch }
    }
    return route.fulfill({ json: chart })
  })
  return sent
}

async function openMovieTab(page: Page) {
  await page.goto('/charts/movie-song')
  await page.getByRole('button', { name: '编辑信息', exact: true }).click()
  await page.getByRole('tab', { name: '试听与视频', exact: true }).click()
}

test('the offset alone is a metadata edit', async ({ page }) => {
  const sent = await mock(page, { ...baseChart, movieHash: 'c'.repeat(64), movieSize: 3 * 1048576 })
  await openMovieTab(page)
  const dialog = page.getByRole('dialog', { name: '编辑谱面信息' })
  await expect(dialog).toContainText('当前有背景视频（3.0 MiB）')
  const offset = page.getByLabel('MOVIEOFFSET（秒）')
  await expect(offset).toHaveValue('0.5')
  await offset.fill('1300')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toContainText('MOVIEOFFSET 必须为秒数')
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  expect(sent).toHaveLength(0)
  await offset.fill('-2.25')
  await page.screenshot({ path: '/tmp/fanmade-movie-edit.png', animations: 'disabled' })
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect.poll(() => sent.length).toBe(1)
  expect(sent[0]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ movieOffset: -2.25 }) })
})

test('a new movie goes up on its own with its offset', async ({ page }) => {
  const sent = await mock(page, { ...baseChart, movieOffset: 0 })
  await openMovieTab(page)
  await expect(page.getByRole('dialog', { name: '编辑谱面信息' })).toContainText('当前没有背景视频')
  const offset = page.getByLabel('MOVIEOFFSET（秒）')
  await expect(offset).toBeDisabled()
  await page
    .getByLabel('选择背景视频')
    .setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('movie') })
  await expect(offset).toBeEnabled()
  await offset.fill('0.75')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '提示' })).toContainText('背景视频已提交')
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatchObject({
    method: 'PUT',
    path: '/api/v1/charts/movie-song/movie',
    prefer: 'respond-async',
  })
  expect(sent[0].body).toContain('name="movieOffset"\r\n\r\n0.75\r\n')
  expect(sent[0].body).toContain('name="movie"; filename="clip.mp4"')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  await page.getByRole('button', { name: '编辑信息', exact: true }).click()
  await page.getByRole('tab', { name: '试听与视频', exact: true }).click()
  await page.getByLabel('MOVIEOFFSET（秒）').scrollIntoViewIfNeeded()
  await page.screenshot({ path: '/tmp/fanmade-movie-edit-mobile.png', animations: 'disabled' })
})
