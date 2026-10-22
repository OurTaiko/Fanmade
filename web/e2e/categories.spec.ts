import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { registerAccount } from './registration-helpers'
import { randomUUID } from 'node:crypto'

const origin = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173'
test.skip(process.env.FANMADE_SSO_E2E !== '1', 'Requires local SSO development servers')
async function login(page: Page) {
  return registerAccount(page, 'cat' + randomUUID().slice(0, 8), randomUUID())
}
async function files(page: Page) {
  await page.getByRole('tab', { name: '文件与封面', exact: true }).click()
  await page.getByLabel('选择 TJA 谱面').setInputFiles({
    name: 'categories.tja',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(
      'TITLE:Category Browser Test\nBPM:120\nWAVE:cbr.mp3\nCOURSE:Oni\nLEVEL:5\n#START\n1000,\n#END\n',
    ),
  })
  await page.getByLabel('选择 OGG 或 MP3 音频').setInputFiles({
    name: 'cbr.mp3',
    mimeType: 'audio/mpeg',
    buffer: readFileSync('../backend/internal/audio/testdata/cbr.mp3'),
  })
  await expect(page.getByRole('dialog', { name: '本地校验通过' })).toBeVisible()
  await page.getByRole('button', { name: '知道了', exact: true }).click()
}
async function publish(page: Page) {
  const response = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/charts',
  )
  await page.getByRole('button', { name: '发布谱面', exact: true }).click()
  const result = await response
  expect(result.status()).toBe(201)
  const chart = await result.json()
  await expect(page).toHaveURL(new RegExp('/charts/' + chart.id + '$'))
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  return chart
}

test('server categories retry, multi-select upload, owner edits and mobile persistence', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const session = await login(page)
  let failCategories = true
  await page.route('**/api/v1/categories', (route) => {
    if (failCategories) {
      return route.fulfill({ status: 503, json: { message: 'Temporary category failure' } })
    }
    return route.continue()
  })
  await page.goto('/upload')
  await page.getByRole('tab', { name: '谱面分类', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('分类加载失败')
  failCategories = false
  await page.getByRole('button', { name: '重试加载分类' }).click()
  await expect(page.getByRole('checkbox')).toHaveCount(6)
  await page.getByRole('checkbox', { name: 'Anime', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Game', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Pop', exact: true }).check()
  await files(page)
  const chart = await publish(page)
  try {
    expect(chart.categoryIds).toEqual(['anime', 'game', 'pop'])
    await expect(page.getByRole('list', { name: '所属分类' }).getByRole('listitem')).toHaveText([
      'Anime',
      'Game',
      'Pop',
    ])
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: '编辑信息', exact: true }).click()
    const modal = page.getByRole('dialog', { name: '编辑谱面信息' })
    await expect(page.getByRole('checkbox', { name: 'Anime', exact: true })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Game', exact: true })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Pop', exact: true })).toBeChecked()
    await page.getByRole('checkbox', { name: 'Game', exact: true }).uncheck()
    await page.getByRole('checkbox', { name: 'Pop', exact: true }).uncheck()
    await page.getByRole('checkbox', { name: 'Anime', exact: true }).uncheck()
    await page.getByRole('checkbox', { name: 'Virtual Singer', exact: true }).check()
    await page.getByRole('checkbox', { name: 'Classic', exact: true }).check()
    const bounds = await modal.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844)
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(modal).not.toBeVisible()
    await page.getByRole('button', { name: '知道了', exact: true }).click()
    const updated = await (await page.request.get('/api/v1/charts/' + chart.id)).json()
    expect(updated.categoryIds).toEqual(['classic', 'virtual-singer'])
    expect(updated.tjaHash).toBe(chart.tjaHash)
    expect(updated.audioHash).toBe(chart.audioHash)
    await expect(page.getByRole('list', { name: '所属分类' }).getByRole('listitem')).toHaveText([
      'Classic',
      'Virtual Singer',
    ])
    await page.reload()
    await page.getByRole('button', { name: '编辑信息', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: 'Virtual Singer', exact: true })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Classic', exact: true })).toBeChecked()
    await page.getByRole('checkbox', { name: 'Virtual Singer', exact: true }).uncheck()
    await page.getByRole('checkbox', { name: 'Classic', exact: true }).uncheck()
    await page.getByRole('checkbox', { name: 'Anime', exact: true }).check()
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await page.getByRole('button', { name: '知道了', exact: true }).click()
    const anime = await (await page.request.get('/api/v1/charts/' + chart.id)).json()
    expect(anime.categoryIds).toEqual(['anime'])
    expect(anime.tjaHash).toBe(chart.tjaHash)
    expect(anime.audioHash).toBe(chart.audioHash)
    await expect(page.getByRole('list', { name: '所属分类' })).toHaveText('Anime')
    await page.reload()
    await page.getByRole('button', { name: '编辑信息', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: 'Anime', exact: true })).toBeChecked()
    await page.getByRole('checkbox', { name: 'Anime', exact: true }).uncheck()
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await page.getByRole('button', { name: '知道了', exact: true }).click()
    const defaulted = await (await page.request.get('/api/v1/charts/' + chart.id)).json()
    expect(defaulted.categoryIds).toEqual(['variety'])
    await expect(page.getByRole('list', { name: '所属分类' }).getByRole('listitem')).toHaveText([
      'Variety',
    ])
    for (const path of ['/', '/me/charts']) {
      await page.goto(path)
      const card = page.locator(`[data-testid="chart-card"][href="/charts/${chart.id}"]`)
      await expect(card.getByRole('list', { name: '所属分类' })).toHaveText('Variety')
    }
    expect(errors).toEqual([])
  } finally {
    await page.request.delete('/api/v1/charts/' + chart.id, {
      headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken },
    })
  }
})

test('upload with no selected categories defaults to Variety', async ({ page }) => {
  const session = await login(page)
  await page.goto('/upload')
  await page.getByRole('tab', { name: '谱面分类', exact: true }).click()
  await expect(page.getByRole('checkbox')).toHaveCount(6)
  await files(page)
  const chart = await publish(page)
  try {
    expect(chart.categoryIds).toEqual(['variety'])
    await expect(page.getByRole('list', { name: '所属分类' })).toHaveText('Variety')
  } finally {
    await page.request.delete('/api/v1/charts/' + chart.id, {
      headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken },
    })
  }
})
