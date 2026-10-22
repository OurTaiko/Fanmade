import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { registerAccount } from './registration-helpers'

const root = process.env.ESE_ROOT || join(homedir(), 'Documents/GitHub/ESE')
const chartPath = join(root, '03 Vocaloid/Happy Synthesizer/Happy Synthesizer.tja')
const audioPath = join(root, '03 Vocaloid/Happy Synthesizer/Happy Synthesizer.ogg')
const wrongAudio = join(root, '05 Variety/Destr0yer/Destr0yer.ogg')

test('register, reject mismatched ESE audio locally, publish, download, delete and logout', async ({
  page,
}) => {
  test.skip(process.env.FANMADE_SSO_E2E !== '1', 'Requires local SSO development servers')
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await registerAccount(page, 'upload' + randomUUID().slice(0, 8), randomUUID())
  const uploadRequests: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/v1/charts')
      uploadRequests.push(r.url())
  })
  await page.getByLabel('选择 TJA 谱面').setInputFiles(chartPath)
  await page.getByLabel('选择 OGG 或 MP3 音频').setInputFiles(wrongAudio)
  await expect(page.getByText('文件校验未通过', { exact: true })).toBeVisible()
  await expect(page.getByText(/第 \d+ 行引用了「Happy Synthesizer.ogg」/)).toBeVisible()
  expect(uploadRequests).toHaveLength(0)
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  await page.getByLabel('选择 OGG 或 MP3 音频').setInputFiles(audioPath)
  await expect(page.getByRole('dialog', { name: '本地校验通过' })).toBeVisible()
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Happy Synthesizer', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '谱面介绍', exact: true }).click()
  await page.getByLabel('投稿说明', { exact: true }).fill('ESE 原始文件 · 浏览器端到端验证')
  await page.getByRole('button', { name: '发布谱面', exact: true }).click()
  await expect(page).toHaveURL(/\/charts\/[a-f0-9]{32}$/, { timeout: 60000 })
  expect(uploadRequests).toHaveLength(1)
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Happy Synthesizer', exact: true })).toBeVisible()
  const tjaURL = await page.getByRole('link', { name: 'TJA 原文件' }).getAttribute('href')
  const bytes = await page.request.get(tjaURL!)
  expect((await bytes.body()).toString('utf8')).toBe(
    readFileSync(chartPath, 'utf8').replace(/^\uFEFF/, ''),
  )
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: '下载谱面包' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('Happy Synthesizer.zip')
  expect(await download.failure()).toBeNull()
  const audio = page.getByRole('group', { name: '音频试听', exact: true }).locator('audio')
  await expect
    .poll(() => audio.evaluate((node: HTMLAudioElement) => node.readyState))
    .toBeGreaterThan(0)
  await page.getByRole('button', { name: '删除作品', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page).toHaveURL(/\/me\/charts$/)
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  await expect(page.getByText('第一份节拍，等你来发布')).toBeVisible()
  expect((await page.request.get(tjaURL!)).status()).toBe(404)
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByRole('link', { name: '登录 / 注册' })).toBeVisible()
  expect(errors).toEqual([])
})

test('ESE library search, detail navigation and mobile layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('searchbox', { name: '搜索谱面' }).fill('Natsumatsuri')
  await expect
    .poll(() => new URL(page.url()).searchParams.get('q'))
    .toBe(await page.getByLabel('搜索谱面').inputValue())
  const title = page
    .getByRole('heading', { name: 'Natsumatsuri -New Audio/Chart-', exact: true })
    .first()
  await expect(title).toBeVisible()
  await title.click()
  await expect(page.getByRole('heading', { name: '谱面介绍' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '难度一览' })).toHaveCount(0)
  await expect(page.getByRole('group', { name: '音频试听' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.goto('/upload')
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  await page.getByLabel('选择 TJA 谱面').setInputFiles(chartPath)
  await page.getByLabel('选择 OGG 或 MP3 音频').setInputFiles(audioPath)
  await expect(page.getByRole('dialog', { name: '本地校验通过' })).toBeVisible()
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
