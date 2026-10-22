import { expect, test } from '@playwright/test'
const base = {
  user: {
    id: 'owner',
    username: 'PrivateLogin123',
    nickname: '公开昵称',
    emailVerified: true,
    isAdmin: false,
  },
  csrfToken: 'csrf',
}
test('profile is managed in SSO and refreshed on return to Fanmade', async ({ page }) => {
  let current = structuredClone(base)
  await page.route('**/api/v1/me', (route) => {
    expect(route.request().method()).toBe('GET')
    return route.fulfill({ json: current })
  })
  await page.goto('/me/profile')
  await expect(page.getByLabel('用户名', { exact: true })).toHaveValue('PrivateLogin123')
  await expect(page.getByLabel('昵称', { exact: true })).toHaveAttribute('readonly', '')
  await expect(page.getByRole('link', { name: '管理 OurTaiko 账号' })).toHaveAttribute(
    'href',
    '/api/v1/auth/account/profile',
  )
  current = { ...base, user: { ...base.user, nickname: 'SSO 新昵称 🎵' } }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('[data-testid="account-nickname"]')).toHaveText('SSO 新昵称 🎵')
  await expect(page.getByLabel('昵称', { exact: true })).toHaveValue('SSO 新昵称 🎵')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/sso-profile-mobile.png', fullPage: true })
})
test('anonymous profile links to SSO login preserving its return page', async ({ page }) => {
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({ json: { user: null, csrfToken: '' } }),
  )
  await page.goto('/me/profile')
  await page.getByRole('link', { name: '前往登录' }).click()
  await expect(page.getByRole('link', { name: '前往账号中心登录' })).toHaveAttribute(
    'href',
    '/api/v1/auth/sso/login?returnTo=%2Fme%2Fprofile',
  )
})
