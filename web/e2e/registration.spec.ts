import { test, expect } from '@playwright/test'

test('login and registration use the account center without collecting credentials', async ({
  page,
}) => {
  await page.goto('/login?returnTo=/me/charts')
  await expect(page.getByRole('link', { name: '前往账号中心登录' })).toHaveAttribute(
    'href',
    '/api/v1/auth/sso/login?returnTo=%2Fme%2Fcharts',
  )
  await expect(page.locator('input[type=password]')).toHaveCount(0)
  await page.goto('/register')
  const register = page.getByRole('link', { name: '创建 OurTaiko 账号' })
  await expect(register).toHaveAttribute('href', '/api/v1/auth/account/register')
  await expect(register).toHaveAttribute('target', '_blank')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
