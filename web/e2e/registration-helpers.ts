import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, type Page } from '@playwright/test'

const origin = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173'
const sso = process.env.SSO_TEST_URL || 'http://127.0.0.1:8090'

export async function loginAccount(page: Page, username: string, password: string) {
  await page.goto(origin + '/api/v1/auth/sso/login?returnTo=/upload')
  if (new URL(page.url()).pathname === '/login/') {
    await page.getByLabel('登录名', { exact: true }).fill(username)
    await page.getByLabel('密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '登录账号', exact: true }).click()
  }
  await page.getByRole('button', { name: '同意并继续', exact: true }).click()
  await expect(page).toHaveURL(origin + '/upload')
  const response = await page.request.get(origin + '/api/v1/me')
  expect(response.status()).toBe(200)
  const session = await response.json()
  expect(session.user).not.toBeNull()
  return session
}

// Real local registration and email verification, followed by the OIDC flow.
// No test-only registration endpoint or shared production account is required.
export async function registerAccount(page: Page, username: string, password: string) {
  if (process.env.FANMADE_SSO_E2E !== '1')
    throw new Error('Set FANMADE_SSO_E2E=1 for local SSO integration')
  for (const url of [origin, sso]) {
    if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
      throw new Error('Local servers only')
  }
  await page.goto(sso + '/register/')
  const email = `${username}@example.test`
  await page.locator('[name=username]').fill(username)
  await page.locator('[name=nickname]').fill(username)
  await page.locator('[name=email]').fill(email)
  await page.locator('[name=password1]').fill(password)
  await page.locator('[name=password2]').fill(password)
  await page.getByRole('button', { name: '创建账号并验证邮箱' }).click()
  await expect(page.getByRole('heading', { name: '去邮箱看看吧' })).toBeVisible()
  const mailbox = resolve(process.env.SSO_TEST_MAIL_DIR || '../../OurTaikoSSO/.data/emails')
  const message = readdirSync(mailbox)
    .map((name) => readFileSync(resolve(mailbox, name), 'utf8'))
    .find((text) => text.includes('To: ' + email))
  const link = message?.match(/http:\/\/[^\s]+\/verify\/[^\s]+/)?.[0]
  if (!link || !link.startsWith(sso + '/verify/'))
    throw new Error('Local verification email missing')
  await page.goto(link)
  await page.getByRole('button', { name: '确认邮箱并激活账号' }).click()
  return loginAccount(page, username, password)
}
