import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { registerAccount } from './registration-helpers'

test.skip(process.env.FANMADE_SSO_E2E !== '1', 'Requires local SSO development servers')

const origin = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173'
const root = process.env.ESE_ROOT || join(homedir(), 'Documents/GitHub/ESE')
const folder = join(root, '03 Vocaloid/Happy Synthesizer')

test('owner edits metadata in a modal, handles errors, restores values and protects visibility', async ({
  page,
  browser,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const session = await registerAccount(page, 'edit' + randomUUID().slice(0, 8), randomUUID())
  expect(session.user.isAdmin).toBe(false)
  const uploaded = await page.request.post('/api/v1/charts', {
    headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': randomUUID() },
    multipart: {
      tja: {
        name: 'Happy Synthesizer.tja',
        mimeType: 'application/octet-stream',
        buffer: readFileSync(join(folder, 'Happy Synthesizer.tja')),
      },
      audio: {
        name: 'Happy Synthesizer.ogg',
        mimeType: 'audio/ogg',
        buffer: readFileSync(join(folder, 'Happy Synthesizer.ogg')),
      },
    },
  })
  expect(uploaded.status()).toBe(201)
  const chart = await uploaded.json()
  const path = '/charts/' + chart.id
  try {
    await page.goto(path)
    const edit = page.getByRole('button', { name: '编辑信息', exact: true })
    await edit.click()
    await page.getByRole('tab', { name: '译名', exact: true }).click()
    const modal = page.getByRole('dialog', { name: '编辑谱面信息' })
    await expect(modal).toBeVisible()
    await expect(page.getByRole('tab', { name: '译名', exact: true })).toBeFocused()
    await expect(page.getByLabel('日文歌名', { exact: true })).toHaveValue(
      chart.titleTranslations.ja,
    )
    await expect(page.getByRole('button', { name: '保存修改', exact: true })).toBeDisabled()
    await page.getByLabel('英文歌名', { exact: true }).fill('Unsaved')
    await page.keyboard.press('Escape')
    await expect(modal).not.toBeVisible()
    await expect(edit).toBeFocused()
    await edit.click()
    await page.getByRole('tab', { name: '译名', exact: true }).click()
    await expect(page.getByLabel('英文歌名', { exact: true })).toHaveValue(chart.title)
    await page.getByLabel('英文歌名', { exact: true }).fill('Edited song')
    await page.getByLabel('英文副标题', { exact: true }).fill('Edited subtitle')
    await page.getByLabel('中文歌名', { exact: true }).fill('编辑后的中文名')
    await page.route('**/api/v1/charts/' + chart.id, (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 503, json: { message: '测试：暂时无法保存' } })
        : route.continue(),
    )
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByRole('alertdialog')).toContainText('测试：暂时无法保存')
    await page.getByRole('button', { name: '知道了', exact: true }).click()
    await expect(page.getByLabel('英文歌名', { exact: true })).toHaveValue('Edited song')
    await page.unroute('**/api/v1/charts/' + chart.id)
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(modal).not.toBeVisible()
    await expect(page.getByRole('dialog', { name: '操作成功' })).toContainText('谱面信息已保存。')
    await page.getByRole('button', { name: '知道了', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Edited song', exact: true })).toBeVisible()
    const updated = await (await page.request.get('/api/v1' + path)).json()
    expect(updated.titleTranslations.zh).toBe('编辑后的中文名')
    expect(updated.tjaHash).toBe(chart.tjaHash)
    expect(updated.audioHash).toBe(chart.audioHash)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Edited song', exact: true })).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await edit.click()
    await page.getByRole('tab', { name: '译名', exact: true }).click()
    const bounds = await modal.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844)
    await page.getByRole('button', { name: '恢复英文原值', exact: true }).click()
    await page.getByRole('button', { name: '恢复中文原值', exact: true }).click()
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await page.getByRole('button', { name: '知道了', exact: true }).click()
    await expect(page.getByRole('heading', { name: chart.title, exact: true })).toBeVisible()
    // A separate account has no button and cannot bypass the API permission check.
    const outsider = await browser.newContext({ baseURL: origin })
    try {
      const otherPage = await outsider.newPage()
      await otherPage.goto(path)
      await expect(otherPage.getByRole('heading', { name: chart.title, exact: true })).toBeVisible()
      await expect(otherPage.getByRole('button', { name: '编辑信息', exact: true })).toHaveCount(0)
      const other = await registerAccount(
        otherPage,
        'other' + randomUUID().slice(0, 8),
        randomUUID(),
      )
      await otherPage.goto(path)
      await expect(otherPage.getByRole('button', { name: '编辑信息', exact: true })).toHaveCount(0)
      const denied = await outsider.request.patch('/api/v1' + path, {
        headers: { Origin: origin, 'X-CSRF-Token': other.csrfToken },
        data: { title: 'Forbidden' },
      })
      expect(denied.status()).toBe(403)
      // Frontend admin visibility; real admin authorization is tested against PostgreSQL in Go.
      await otherPage.route('**/api/v1/me', (route) =>
        route.fulfill({ json: { ...other, user: { ...other.user, isAdmin: true } } }),
      )
      await otherPage.goto(path)
      await expect(otherPage.getByRole('button', { name: '编辑信息', exact: true })).toBeVisible()
      await otherPage.getByRole('button', { name: '编辑信息', exact: true }).click()
      await expect(otherPage.getByRole('dialog')).toBeVisible()
    } finally {
      await outsider.close()
    }
    expect(errors).toEqual([])
  } finally {
    await page.request.delete('/api/v1' + path, {
      headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken },
      data: {},
    })
  }
})
