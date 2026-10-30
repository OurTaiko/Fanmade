import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import type { Chart } from '../src/api/types'

const audio = readFileSync('../kit/audio/testdata/cbr.mp3')
const source =
  'TITLE:Replacement preview\nSUBTITLE:New subtitle\nMAKER:A\nBPM:120\nWAVE:cbr.mp3\n' +
  ['Hard', 'Oni'].map((course) => `COURSE:${course}\nLEVEL:5\n#START\n1000,\n#END\n`).join('')
const original: Chart = {
  id: 'a'.repeat(32),
  ownerId: 'owner',
  uploader: 'tester',
  title: 'Original song',
  subtitle: '',
  maker: 'A',
  bpm: 120,
  offset: 0,
  demoStart: 0,
  wave: 'cbr.mp3',
  description: 'Keep description',
  categoryIds: ['variety'],
  duration: 1,
  encoding: 'utf-8',
  tjaName: 'chart.tja',
  audioName: 'cbr.mp3',
  tjaHash: 'c'.repeat(64),
  audioHash: 'd'.repeat(64),
  audioSize: audio.length,
  createdAt: '2026-09-15T00:00:00Z',
  titleTranslations: {},
  subtitleTranslations: {},
  difficulties: [
    {
      course: 'Hard',
      level: 5,
      maker: 'A',
    },
  ],
}

for (const { actor, replaceAudio } of ['owner', 'admin'].flatMap((actor) =>
  [false, true].map((replaceAudio) => ({ actor, replaceAudio })),
)) {
  test(`${actor} replaces chart ${replaceAudio ? 'with audio and cover' : 'retaining audio and cover'}, confirm destructive update`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    let current = original
    let submitted: FormData | undefined
    let attempts = 0
    let requestKey = ''
    const cover = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#0071e3' },
    })
      .png()
      .toBuffer()
    await page.route('**/api/v1/**', (route) =>
      route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20, unreadCount: 0 } }),
    )
    await page.route('**/api/v1/me', (route) =>
      route.fulfill({
        json: {
          user: {
            id: actor,
            username: 'tester',
            nickname: '测试昵称',
            isAdmin: actor === 'admin',
            emailVerified: true,
          },
          csrfToken: 'csrf',
        },
      }),
    )
    await page.route('**/api/v1/categories', (route) =>
      route.fulfill({ json: { items: [{ id: 'variety', title: '综艺', genre: 'バラエティ' }] } }),
    )
    await page.route(`**/api/v1/charts/${original.id}*`, (route) =>
      route.fulfill({ json: current }),
    )
    await page.route('**/api/v1/charts/*/tja', (route) => route.fulfill({ body: source }))
    await page.route('**/api/v1/charts/*/audio', (route) =>
      route.fulfill({ body: audio, contentType: 'audio/mpeg' }),
    )
    await page.route('**/leaderboard?*', (route) =>
      route.fulfill({
        json: {
          songId: current.id,
          difficulty: 'Hard',
          supported: true,
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
        },
      }),
    )
    const parsed = {
      title: 'Replacement preview',
      subtitle: 'New subtitle',
      titleTranslations: { origin: 'Replacement preview' },
      subtitleTranslations: { origin: 'New subtitle' },
      maker: 'A',
      bpm: 120,
      offset: 0,
      demoStart: 0,
      wave: 'cbr.mp3',
      movieOffset: 0,
      difficulties: ['Hard', 'Oni'].map((course) => ({
        course,
        side: 'single',
        level: 5,
        maker: 'A',
        chartHash: 'v1:' + 'a'.repeat(64),
      })),
    }
    let previews = 0
    await page.route(`**/api/v1/charts/${original.id}/files/preview`, async (route) => {
      expect(route.request().method()).toBe('POST')
      expect(route.request().headers()['x-csrf-token']).toBe('csrf')
      previews++
      await route.fulfill({
        json: {
          metadata: parsed,
          previous: { ...parsed, title: 'Original song', titleTranslations: {} },
          blocks: [
            { course: 'Hard', side: 'single', change: 'same', scores: 2 },
            { course: 'Oni', side: 'single', change: 'added', scores: 0 },
          ],
        },
      })
    })
    await page.route(`**/api/v1/charts/${original.id}/files`, async (route) => {
      expect(route.request().method()).toBe('PUT')
      expect(route.request().headers()['x-csrf-token']).toBe('csrf')
      expect(route.request().headers()['idempotency-key']).toMatch(/^[a-f0-9]{32}$/)
      submitted = await new Response(route.request().postDataBuffer()!, {
        headers: { 'Content-Type': route.request().headers()['content-type'] },
      }).formData()
      if (requestKey) expect(route.request().headers()['idempotency-key']).toBe(requestKey)
      requestKey = route.request().headers()['idempotency-key']
      attempts++
      // A recoverable server failure leaves the selected files and maker edits intact.
      if (attempts === 1)
        return route.fulfill({ status: 503, json: { message: '保存失败，旧数据保持不变' } })
      current = {
        ...original,
        tjaHash: 'e'.repeat(64),
        audioHash: replaceAudio ? 'f'.repeat(64) : original.audioHash,
        title: 'Replacement preview',
        maker: 'A | B',
        difficulties: [
          original.difficulties[0],
          { ...original.difficulties[0], course: 'Oni', maker: 'B' },
        ],
      }
      await route.fulfill({ json: current })
    })
    await page.goto(`/charts/${original.id}`)
    await page.getByRole('link', { name: '更新歌曲与谱面' }).click()
    await expect(page.getByRole('heading', { name: '更新歌曲与谱面' })).toBeVisible()
    await expect(page.getByLabel('更新须知')).toContainText('只改标题、译名等头部信息不影响成绩')
    await page.getByRole('tab', { name: '谱面介绍', exact: true }).click()
    await expect(page.getByLabel('投稿说明')).toHaveValue('Keep description')
    await page.getByRole('tab', { name: '文件与封面', exact: true }).click()
    const coverPicker = page.getByLabel('选择 JPG/JPEG、PNG 或 WebP 封面')
    await expect(coverPicker).toBeVisible()
    if (replaceAudio) {
      await coverPicker.setInputFiles({
        name: 'replacement.png',
        mimeType: 'image/png',
        buffer: cover,
      })
      await expect(page.getByAltText('待上传的封面预览')).toBeVisible()
    }
    await page
      .getByLabel('选择 TJA 谱面')
      .setInputFiles({ name: 'updated.tja', mimeType: 'text/plain', buffer: Buffer.from(source) })
    await expect(page.getByRole('dialog', { name: '本地校验通过' })).toBeVisible()
    await page.getByRole('button', { name: '知道了', exact: true }).click()
    if (replaceAudio) {
      await page
        .getByLabel('选择 OGG 或 MP3 音频')
        .setInputFiles({ name: 'cbr.mp3', mimeType: 'audio/mpeg', buffer: audio })
      await expect(page.getByRole('dialog', { name: '本地校验通过' })).toBeVisible()
      await page.getByRole('button', { name: '知道了', exact: true }).click()
    }
    await page.screenshot({
      path: `/tmp/fanmade-update-cover-${actor}-${replaceAudio}.png`,
      fullPage: true,
    })
    await page.getByRole('tab', { name: '试听', exact: true }).click()
    await page.getByLabel('试听开始（秒）').fill('0.1')
    await page.getByLabel('试听结束（秒）').fill('0.3')
    await page.getByRole('tab', { name: '谱师名义', exact: true }).click()
    await page.getByLabel('Oni 制作者').fill('B')
    await page.screenshot({
      path: `test-results/replacement-${replaceAudio}-desktop.png`,
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true)
    await page.getByRole('button', { name: '更新歌曲与谱面', exact: true }).click()
    const review = page.getByRole('alertdialog', { name: '确认更新内容' })
    await expect(review).toContainText('Original song')
    await expect(review).toContainText('0.1–0.3')
    await expect(review).toContainText('新增')
    if (replaceAudio) {
      await expect(review).toContainText('音频内容有变化')
      await expect(review).toContainText('2 条成绩移出排行榜')
    } else await expect(review).toContainText('沿用「cbr.mp3」')
    // The file renamed the song, so the new title is proposed; the range was typed.
    await expect(review.getByRole('checkbox')).toHaveCount(2)
    for (const box of await review.getByRole('checkbox').all()) await expect(box).not.toBeChecked()
    await page.screenshot({
      path: `test-results/replacement-${replaceAudio}-confirmation.png`,
      animations: 'disabled',
    })
    await page.getByRole('button', { name: '取消', exact: true }).click()
    expect(attempts).toBe(0)
    await page.getByRole('button', { name: '更新歌曲与谱面', exact: true }).click()
    if (!replaceAudio) await review.getByRole('checkbox').first().click()
    await page.getByRole('button', { name: '确认更新' }).click()
    await expect(page.getByRole('alertdialog')).toContainText('保存失败，旧数据保持不变')
    await page.getByRole('button', { name: '知道了', exact: true }).click()
    await expect(page.getByLabel('Oni 制作者')).toHaveValue('B')
    await page.getByRole('button', { name: '更新歌曲与谱面', exact: true }).click()
    if (!replaceAudio) await review.getByRole('checkbox').first().click()
    await page.getByRole('button', { name: '确认更新' }).click()
    await expect(page).toHaveURL(`/charts/${original.id}`)
    expect(attempts).toBe(2)
    expect(previews).toBe(3)
    expect(submitted?.get('keepTitles')).toBe(replaceAudio ? null : 'true')
    expect(submitted?.get('demoStart')).toBe('0.1')
    expect(submitted?.has('expectedVersionId')).toBe(false)
    expect(submitted?.get('confirmReset')).toBe('true')
    expect(submitted?.has('audio')).toBe(replaceAudio)
    expect(submitted?.has('cover')).toBe(replaceAudio)
    if (replaceAudio) {
      const selectedCover = submitted?.get('cover') as File
      expect(selectedCover.name).toBe('replacement.png')
      expect(Buffer.from(await selectedCover.arrayBuffer())).toEqual(cover)
    }
    expect(submitted?.get('description')).toBe(original.description)
    expect(JSON.parse(String(submitted?.get('difficultyMakers')))).toEqual([
      { course: 'Hard', side: 'single', maker: 'A' },
      { course: 'Oni', side: 'single', maker: 'B' },
    ])
    await page.getByRole('button', { name: '知道了', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Replacement preview' })).toBeVisible()
    await expect(page.locator('[data-testid="detail-facts"]')).toContainText('A | B')
    expect(errors).toEqual([])
  })
}
