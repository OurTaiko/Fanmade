import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const audio = readFileSync('../kit/audio/testdata/cbr.mp3')
const chart = (title: string, headers: string) =>
  `TITLE:${title}\nBPM:120\n${headers}COURSE:Oni\nLEVEL:5\n#START\n1000,\n#END\n`

async function folder(files: Record<string, string | Buffer>) {
  const root = mkdtempSync(join(tmpdir(), 'fanmade-folder-'))
  for (const [path, data] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), data)
  }
  return root
}
const image = () =>
  sharp({ create: { width: 40, height: 30, channels: 3, background: '#d83a2c' } })
    .png()
    .toBuffer()

type Sent = { key: string; fields: Record<string, string> }
async function mockApi(page: Page, answer: (count: number) => { status: number; json: unknown }) {
  const sent: Sent[] = []
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/v1/me')
      return route.fulfill({
        json: {
          user: {
            id: 'owner',
            username: 'tester',
            nickname: '测试',
            isAdmin: false,
            emailVerified: true,
          },
          csrfToken: 'csrf',
        },
      })
    if (path === '/api/v1/categories') return route.fulfill({ json: { items: [] } })
    if (path === '/api/v1/me/notifications/unread') return route.fulfill({ json: { count: 0 } })
    if (path === '/api/v1/charts' && request.method() === 'POST') {
      const form = await new Response(request.postDataBuffer()!, {
        headers: { 'Content-Type': request.headers()['content-type'] },
      }).formData()
      const fields: Record<string, string> = {}
      for (const [name, value] of form.entries())
        fields[name] = typeof value === 'string' ? value : `file:${value.name}`
      sent.push({ key: request.headers()['idempotency-key'], fields })
      const { status, json } = answer(sent.length)
      return route.fulfill({ status, json })
    }
    return route.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: 'not found' } })
  })
  return sent
}

test('a folder of one chart fills the form with the files its headers name', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const sent = await mockApi(page, () => ({ status: 202, json: { status: 'processing' } }))
  const root = await folder({
    'Song/song.tja': chart(
      'Folder song',
      'WAVE:Song.MP3\nPREIMAGE:img\\Jacket.png\nBGIMAGE:img/back.png\n',
    ),
    'Song/img/Back.png': await image(),
    'Song/song.mp3': audio,
    'Song/img/jacket.png': await image(),
    'Song/notes.txt': 'not part of the chart',
  })
  await page.goto('/me/charts/publish')
  await page.locator('input[webkitdirectory]').setInputFiles(join(root, 'Song'))
  await expect(page.getByRole('dialog', { name: '本地校验通过' })).toBeVisible()
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Folder song', exact: true })).toBeVisible()
  await expect(page.getByText('song.tja', { exact: true })).toBeVisible()
  // The audio takes the name WAVE gives it, whatever case the folder has.
  await expect(page.getByText('Song.MP3', { exact: true })).toBeVisible()
  await expect(page.getByAltText('待上传的封面预览')).toBeVisible()
  await page.getByRole('button', { name: '发布谱面', exact: true }).click()
  await expect.poll(() => sent.length).toBe(1)
  expect(sent[0].fields).toMatchObject({
    tja: 'file:song.tja',
    audio: 'file:Song.MP3',
    cover: 'file:Jacket.png',
    bgimage: 'file:back.png',
  })
  expect(errors).toEqual([])
})

test('a cover other than PREIMAGE names blocks publishing', async ({ page }) => {
  await mockApi(page, () => ({ status: 202, json: { status: 'processing' } }))
  const root = await folder({
    'S/s.tja': chart('Wrong cover', 'WAVE:s.mp3\nPREIMAGE:jacket.png\n'),
    'S/s.mp3': audio,
    'other.png': await image(),
  })
  await page.goto('/me/charts/publish')
  await page.locator('input[webkitdirectory]').setInputFiles(join(root, 'S'))
  await expect(
    page.getByText(/PREIMAGE 引用的「jacket.png」不在文件夹里，将不带这张图片发布/),
  ).toBeVisible()
  // The notices come one at a time: the missing image, then the passed checks.
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '本地校验通过' })).toBeVisible()
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  await page.getByLabel('选择 JPG/JPEG、PNG 或 WebP 封面').setInputFiles(join(root, 'other.png'))
  await expect(
    page.getByText(/PREIMAGE 引用了「jacket.png」，但你选择的封面是「other.png」/),
  ).toBeVisible()
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  await expect(page.getByRole('button', { name: '发布谱面', exact: true })).toBeDisabled()
})

test('a folder of several charts publishes them one by one', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  // The server is busy once, then takes every chart.
  const sent = await mockApi(page, (count) =>
    count === 1
      ? {
          status: 503,
          json: { code: 'UPLOAD_BUSY', message: '当前排队处理的上传较多，请稍后重试' },
        }
      : { status: 202, json: { status: 'processing' } },
  )
  const root = await folder({
    'pack/A/a.tja': chart('Alpha', 'WAVE:a.mp3\nPREIMAGE:a.png\nBGMOVIE:a.mp4\n'),
    'pack/A/a.mp3': audio,
    'pack/A/a.png': await image(),
    'pack/A/a.mp4': Buffer.from('movie'),
    'pack/B/b.tja': chart('Bravo', 'WAVE:b.mp3\n'),
    'pack/B/b.mp3': audio,
    // Not named by a header: not the cover.
    'pack/B/cover.png': await image(),
    'pack/C/c.tja': chart('Charlie', 'WAVE:c.mp3\n'),
  })
  await page.goto('/me/charts/publish')
  await page.locator('input[webkitdirectory]').setInputFiles(join(root, 'pack'))
  await expect(page.getByRole('heading', { name: '批量发布' })).toBeVisible()
  await expect(page.getByText('找到 3 份谱面')).toBeVisible()
  await expect(page.getByText('WAVE 引用的「c.mp3」不在文件夹里')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: '发布「Charlie」' })).toBeDisabled()
  const publish = page.getByRole('button', { name: '发布选中的 2 份' })
  await expect(publish).toBeEnabled()
  await page.screenshot({ path: test.info().outputPath('batch-ready.png'), fullPage: true })
  await publish.click()
  await expect(page.getByText('已提交 2 份，处理结果会通过通知告诉你。')).toBeVisible({
    timeout: 20000,
  })
  await expect(page.getByText('已提交', { exact: true })).toHaveCount(2)
  await page.screenshot({ path: test.info().outputPath('batch-done.png'), fullPage: true })
  // The busy reply is retried as the same request; each chart has its own.
  expect(sent).toHaveLength(3)
  expect(sent[0].key).toBe(sent[1].key)
  expect(sent[2].key).not.toBe(sent[1].key)
  expect(sent[1].fields).toMatchObject({
    tja: 'file:a.tja',
    audio: 'file:a.mp3',
    cover: 'file:a.png',
    movie: 'file:a.mp4',
    categoryIds: '[]',
  })
  // Without PREIMAGE there is no cover, whatever images the folder has.
  expect(sent[2].fields).toMatchObject({ tja: 'file:b.tja', audio: 'file:b.mp3' })
  expect([sent[2].fields.cover, sent[2].fields.bgimage, sent[2].fields.movie]).toEqual([
    undefined,
    undefined,
    undefined,
  ])
  expect(errors).toEqual([])
})

test('dropped loose files are matched the same way', async ({ page }) => {
  await mockApi(page, () => ({ status: 202, json: { status: 'processing' } }))
  await page.goto('/me/charts/publish')
  const png = (await image()).toString('base64')
  const transfer = await page.evaluateHandle(
    ({ tja, mp3, png }) => {
      const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const data = new DataTransfer()
      data.items.add(new File([tja], 'drop.tja'))
      data.items.add(new File([bytes(mp3)], 'drop.mp3'))
      data.items.add(new File([bytes(png)], 'drop.png'))
      data.items.add(new File(['x'], 'readme.txt'))
      return data
    },
    {
      tja: chart('Dropped', 'WAVE:drop.mp3\nPREIMAGE:drop.png\n'),
      mp3: audio.toString('base64'),
      png,
    },
  )
  await page
    .getByText('把谱面文件夹或文件拖到这里')
    .dispatchEvent('drop', { dataTransfer: transfer })
  await expect(page.getByRole('dialog', { name: '本地校验通过' })).toBeVisible()
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Dropped', exact: true })).toBeVisible()
  await expect(page.getByAltText('待上传的封面预览')).toBeVisible()
})
