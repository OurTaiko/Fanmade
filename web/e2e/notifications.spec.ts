import { test, expect } from '@playwright/test'

test('cancelled or expired SSO authorization displays a dismissible error and retry link', async ({
  page,
}) => {
  await page.goto('/login?error=sso')
  const popup = page.getByRole('alertdialog')
  await expect(popup).toContainText('登录未完成或授权已过期')
  await page.keyboard.press('Escape')
  await expect(popup).toHaveCount(0)
  await expect(page.getByRole('link', { name: '前往账号中心登录' })).toBeVisible()
})
test('identity provider outage reports an error on mobile', async ({ page }) => {
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({ status: 503, json: { message: '账号中心暂时不可用' } }),
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/me/profile')
  const popup = page.getByRole('alertdialog')
  await expect(popup).toContainText('账号中心暂时不可用')
  await popup.getByRole('button', { name: '知道了' }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
