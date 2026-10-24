import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import type { Chart } from '../src/api/types'

const id = 'cover-fixture'
const source =
  'TITLE:Cover test\nBPM:120\nWAVE:music.ogg\n' +
  ['Easy', 'Normal', 'Hard', 'Oni', 'Edit']
    .map((course, index) => `COURSE:${course}\nLEVEL:${index + 6}\n#START\n1000,\n#END\n`)
    .join('')
const makeChart = (): Chart => ({
  id,
  ownerId: 'owner',
  uploader: '测试上传者',
  title: 'Cover test',
  subtitle: '封面与节奏',
  maker: '测试谱师',
  bpm: 120,
  offset: 0,
  demoStart: 0,
  wave: 'music.ogg',
  description: '谱面介绍始终可见。',
  createdAt: '2026-09-22T12:00:00Z',
  duration: 100,
  encoding: 'utf-8',
  tjaName: 'chart.tja',
  audioName: 'music.ogg',
  tjaHash: 'a'.repeat(64),
  audioHash: 'b'.repeat(64),
  audioSize: 100,
  categoryIds: ['variety'],
  titleTranslations: {},
  subtitleTranslations: {},
  difficulties: ['Easy', 'Normal', 'Hard', 'Oni', 'Edit'].map((course, blockIndex) => ({
    course,

    level: blockIndex + 6,

    maker: '测试谱师',
  })),
})
const artwork = Buffer.from(
  '<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="600" fill="#0071e3"/><circle cx="560" cy="220" r="190" fill="#ffb68b"/><circle cx="580" cy="210" r="95" fill="#fff"/><path d="M0 440L800 270V600H0Z" fill="#194368"/></svg>',
)

for (const format of ['PNG/JPG', 'WebP', 'JPEG']) {
  const useWebP = format === 'WebP'
  const useJPEG = format === 'JPEG'
  test(`optional ${format} cover upload, owner replacement, failure retention and immediate refresh`, async ({
    page,
  }) => {
    const png = await sharp(artwork).png().toBuffer()
    const jpg = await sharp(artwork).jpeg().toBuffer()
    const webp = await sharp(artwork).webp().toBuffer()
    const upload = {
      name: useWebP ? 'cover.webp' : useJPEG ? 'cover.jpeg' : 'cover.png',
      mimeType: useWebP ? 'image/webp' : useJPEG ? 'image/jpeg' : 'image/png',
      buffer: useWebP ? webp : useJPEG ? jpg : png,
    }
    const replacement = {
      name: useWebP ? 'replacement.WEBP' : useJPEG ? 'replacement.JPEG' : 'replacement.jpg',
      mimeType: useWebP ? 'image/webp' : 'image/jpeg',
      buffer: useWebP ? webp : jpg,
    }
    let chart = makeChart()
    let currentUser: string | null = 'owner'
    let failSave = false
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (path === '/api/v1/me')
        return route.fulfill({
          json: {
            user: currentUser
              ? {
                  id: currentUser,
                  nickname: '测试上传者',
                  username: 'tester',
                  isAdmin: currentUser === 'admin',
                  emailVerified: true,
                }
              : null,
            csrfToken: 'fixture',
          },
        })
      if (path === '/api/v1/categories')
        return route.fulfill({
          json: { items: [{ id: 'variety', title: 'Variety', genre: 'VARIETY' }] },
        })
      if (path === `/api/v1/charts/${id}/cover` && request.method() === 'PUT') {
        expect(request.headers()['x-csrf-token']).toBe('fixture')
        const form = await new Response(request.postDataBuffer(), {
          headers: { 'Content-Type': request.headers()['content-type'] },
        }).formData()
        expect((form.get('cover') as File).name).toBe(replacement.name)
        expect(Buffer.from(await (form.get('cover') as File).arrayBuffer())).toEqual(
          replacement.buffer,
        )
        if (failSave) return route.fulfill({ status: 503, json: { message: '封面暂时无法保存' } })
        chart = { ...chart, coverHash: currentUser === 'admin' ? 'admin-cover' : 'new-cover' }
        return route.fulfill({ json: { coverHash: chart.coverHash } })
      }
      if (path === `/api/v1/charts/${id}/cover`)
        return route.fulfill({ contentType: 'image/webp', body: webp })
      if (path === '/api/v1/charts' && request.method() === 'POST') {
        const form = await new Response(request.postDataBuffer(), {
          headers: { 'Content-Type': request.headers()['content-type'] },
        }).formData()
        expect((form.get('cover') as File).name).toBe(upload.name)
        expect(Buffer.from(await (form.get('cover') as File).arrayBuffer())).toEqual(upload.buffer)
        chart = { ...chart, coverHash: 'first-cover' }
        return route.fulfill({ status: 201, json: chart })
      }
      if (path === '/api/v1/charts')
        return route.fulfill({
          json: {
            items: [
              chart,
              { ...chart, id: 'coverless', title: '尚未添加封面', coverHash: undefined },
            ],
            total: 2,
            page: 1,
            pageSize: 12,
          },
        })
      if (path === `/api/v1/charts/${id}`) return route.fulfill({ json: chart })
      if (path.endsWith('/tja')) return route.fulfill({ body: source })
      return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } })
    })
    await page.goto('/me/charts/publish')
    const picker = page.getByLabel('选择 JPG/JPEG、PNG 或 WebP 封面')
    await picker.setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: artwork })
    await expect(page.getByText('封面仅支持 .jpg、.jpeg、.png 或 .webp 文件。')).toBeVisible()
    await picker.setInputFiles({
      name: 'too-large.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(8 * 1024 * 1024 + 1),
    })
    await expect(page.getByText('封面不能为空，且不能超过 8 MiB。')).toBeVisible()
    await picker.setInputFiles(upload)
    await expect(page.getByAltText('待上传的封面预览')).toBeVisible()
    await page
      .getByLabel('选择 TJA 谱面')
      .setInputFiles({ name: 'chart.tja', mimeType: 'text/plain', buffer: Buffer.from(source) })
    await page.getByLabel('选择 OGG 或 MP3 音频').setInputFiles({
      name: 'music.ogg',
      mimeType: 'audio/ogg',
      buffer: Buffer.from('OggS fixture'),
    })
    await expect(page.getByRole('dialog', { name: '本地校验通过' })).toBeVisible()
    await page.getByRole('button', { name: '知道了', exact: true }).click()
    await page.getByRole('button', { name: '发布谱面', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '操作成功' })).toBeVisible()
    await page.getByRole('button', { name: '知道了', exact: true }).click()
    await expect(page.getByAltText('Cover test的封面')).toHaveAttribute('src', /first-cover/)
    await page.getByRole('button', { name: '修改封面', exact: true }).click()
    await page.getByLabel('选择 JPG/JPEG、PNG 或 WebP 封面').setInputFiles(replacement)
    const dialog = page.getByRole('dialog', { name: '修改歌曲封面' })
    const longName = '12dc1af5558a87267fdb57387c84f8e84ff9e971dc74c3ea8991e'.repeat(4) + '.jpg'
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 640, height: 720 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport)
      await picker.setInputFiles({ name: longName, mimeType: 'image/jpeg', buffer: jpg })
      await page.getByAltText('待上传的封面预览').evaluate((img: HTMLImageElement) => img.decode())
      await expect
        .poll(() => dialog.evaluate((element) => element.scrollWidth - element.clientWidth))
        .toBeLessThanOrEqual(1)
      for (const name of ['关闭提示', '取消选择', '保存封面']) {
        const button = dialog.getByRole('button', { name, exact: true })
        await button.scrollIntoViewIfNeeded()
        const frame = await dialog.boundingBox()
        const bounds = await button.boundingBox()
        expect(frame).not.toBeNull()
        expect(bounds).not.toBeNull()
        expect(bounds!.x).toBeGreaterThanOrEqual(frame!.x)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(frame!.x + frame!.width)
        await button.click({ trial: true })
      }
      await page.screenshot({ path: `/tmp/fanmade-cover-dialog-${viewport.width}.png` })
      await dialog.getByRole('button', { name: '取消选择', exact: true }).click()
      await expect(page.getByAltText('待上传的封面预览')).toHaveCount(0)
      await expect(dialog.getByRole('button', { name: '保存封面', exact: true })).toBeDisabled()
    }
    await page.setViewportSize({ width: 1280, height: 900 })
    await picker.setInputFiles(replacement)
    failSave = true
    await page.getByRole('button', { name: '保存封面', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText('封面暂时无法保存')
    await expect(page.getByAltText('Cover test的封面')).toHaveAttribute('src', /first-cover/)
    failSave = false
    await page.getByRole('button', { name: '保存封面', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '修改歌曲封面' })).toHaveCount(0)
    await expect(page.getByAltText('Cover test的封面')).toHaveAttribute('src', /new-cover/)
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.goto('/')
        const card = page.getByTestId('chart-card').first()
        await expect(card.locator('img')).toHaveAttribute('src', /new-cover/)
        await expect(card.locator('img')).toBeVisible()
        await card.locator('img').evaluate((img: HTMLImageElement) => img.decode())
        await expect
          .poll(() =>
            card
              .locator('img')
              .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
          )
          .toBe(true)
        await expect(card.getByRole('list', { name: '谱面难度' }).locator('li')).toHaveCount(5)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        )
        await page.screenshot({ path: `/tmp/fanmade-cover-library-${colorScheme}-${width}.png` })
        await card.click()
        await expect(page.getByAltText('Cover test的封面')).toBeVisible()
        await expect(page.getByRole('region', { name: '谱面介绍', exact: true })).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        )
        await page.screenshot({ path: `/tmp/fanmade-cover-detail-${colorScheme}-${width}.png` })
      }
    }
    currentUser = 'admin'
    await page.reload()
    await page.getByRole('button', { name: '修改封面', exact: true }).click()
    await picker.setInputFiles(replacement)
    await page.getByRole('button', { name: '保存封面', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '修改歌曲封面' })).toHaveCount(0)
    await expect(page.getByAltText('Cover test的封面')).toHaveAttribute('src', /admin-cover/)
    await expect(page.getByRole('button', { name: '删除作品', exact: true })).toHaveCount(0)
    for (const user of [null, 'other']) {
      currentUser = user
      await page.reload()
      await expect(page.getByAltText('Cover test的封面')).toBeVisible()
      await expect(page.getByRole('button', { name: '修改封面', exact: true })).toHaveCount(0)
    }
    expect(errors).toEqual([])
  })
}
