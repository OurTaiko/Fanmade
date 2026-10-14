import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Chart, PublicUser } from '../src/api/types'

const owner = 'a'.repeat(32)
const other = 'b'.repeat(32)
const member: PublicUser = {
  id: owner,
  nickname: '雨音 Vanilla',
  firstLoginAt: '2026-09-01T12:00:00Z',
  lastActiveAt: '2026-09-24T10:00:00Z',
  chartCount: 2,
  scoreCount: 8,
}
const legacy: PublicUser = {
  id: other,
  nickname: '旧账号',
  firstLoginAt: null,
  lastActiveAt: null,
  chartCount: 0,
  scoreCount: 0,
}
const chart: Chart = {
  id: 'c'.repeat(32),
  title: '夏日鼓点',
  subtitle: '',
  maker: 'Vanilla',
  bpm: 160,
  offset: 0,
  demoStart: 0,
  wave: 'audio.ogg',
  ownerId: owner,
  uploader: member.nickname!,
  categoryIds: [],
  description: '',
  createdAt: '2026-09-20T00:00:00Z',
  duration: 90,
  encoding: 'utf-8',
  tjaName: 'chart.tja',
  audioName: 'audio.ogg',
  tjaHash: 'e'.repeat(64),
  audioHash: 'f'.repeat(64),
  audioSize: 100,
  titleTranslations: {},
  subtitleTranslations: {},
  difficulties: [
    {
      course: 'Oni',
      level: 8,

      maker: 'Vanilla',
    },
  ],
}
async function fixture(page: Page, language = 'zh-hans') {
  let directoryFailure = false
  let namesAvailable = true
  const chartRequests: URL[] = []
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path === '/api/v1/me')
      return route.fulfill({
        json: {
          user: {
            id: owner,
            nickname: '雨音 Vanilla',
            username: 'PrivateLogin123',
            emailVerified: true,
            isAdmin: false,
            preferredLanguage: language,
          },
          csrfToken: 'private-csrf',
        },
      })
    if (path === '/api/v1/categories') return route.fulfill({ json: { items: [] } })
    if (path === '/api/v1/users') {
      if (directoryFailure)
        return route.fulfill({
          status: 503,
          json: { code: 'SERVICE_UNAVAILABLE', message: '暂时无法加载' },
        })
      const q = url.searchParams.get('q') || ''
      const second = url.searchParams.get('page') === '2'
      const users = q
        ? member.nickname!.includes(q)
          ? [member]
          : []
        : second
          ? [legacy]
          : [member, legacy]
      return route.fulfill({
        json: {
          items: users.map((u) => ({ ...u, nickname: namesAvailable ? u.nickname : null })),
          total: q ? users.length : 13,
          page: second ? 2 : 1,
          pageSize: 12,
          profilesAvailable: namesAvailable,
        },
      })
    }
    if (path.startsWith('/api/v1/users/')) {
      const id = path.split('/').at(-1)
      const user = id === owner ? member : id === other ? legacy : null
      return user
        ? route.fulfill({
            json: {
              user: { ...user, nickname: namesAvailable ? user.nickname : null },
              profilesAvailable: namesAvailable,
            },
          })
        : route.fulfill({ status: 404, json: { code: 'USER_NOT_FOUND', message: '用户不存在' } })
    }
    if (path === '/api/v1/charts') {
      chartRequests.push(url)
      const selected = url.searchParams.get('owner') === owner
      return route.fulfill({
        json: {
          items: selected ? [chart] : [],
          total: selected ? 1 : 0,
          page: Number(url.searchParams.get('page')) || 1,
          pageSize: 12,
        },
      })
    }
    return route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } })
  })
  return {
    chartRequests,
    fail(value: boolean) {
      directoryFailure = value
    },
    names(value: boolean) {
      namesAvailable = value
    },
  }
}

test('directory searches, paginates, recovers and links every user to their space', async ({
  page,
}) => {
  const mock = await fixture(page)
  await page.goto('/users')
  await expect(page.getByRole('heading', { name: '用户广场', exact: true })).toBeVisible()
  await expect(page.getByRole('article')).toHaveCount(2)
  await expect(page.getByRole('article', { name: '旧账号' }).getByText('暂无记录')).toHaveCount(2)
  await expect(page.locator('main')).not.toContainText('PrivateLogin123')
  await expect(page.locator('main')).not.toContainText('private-csrf')
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page).toHaveURL(/page=2/)
  await expect(page.getByRole('article')).toHaveCount(1)
  await page.getByRole('searchbox', { name: '搜索用户' }).fill('雨音')
  await expect(page).toHaveURL(/page=1/)
  await expect(page.getByRole('article')).toHaveCount(1)
  await page.getByRole('link', { name: '访问 雨音 Vanilla 的个人空间' }).click()
  await expect(page).toHaveURL(`/users/${owner}`)
  await expect(page.getByRole('heading', { name: '雨音 Vanilla 的个人空间' })).toBeVisible()
  await expect(page.getByTestId('chart-card')).toContainText('夏日鼓点')
  expect(mock.chartRequests.at(-1)?.searchParams.get('owner')).toBe(owner)
  await expect(page.getByRole('link', { name: '管理我的账号' })).toBeVisible()
  await page.getByRole('searchbox', { name: '搜索谱面' }).fill('夏日')
  await expect.poll(() => mock.chartRequests.at(-1)?.searchParams.get('q')).toBe('夏日')
  expect(mock.chartRequests.at(-1)?.searchParams.get('owner')).toBe(owner)
  await page.getByRole('link', { name: '返回用户广场' }).click()
  mock.fail(true)
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(page.getByText('暂时无法加载', { exact: true })).toBeVisible()
  mock.fail(false)
  mock.names(false)
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(page.getByText('昵称暂时无法获取，作品与成绩统计仍可查看。')).toBeVisible()
  await expect(page.getByRole('article')).toHaveCount(2)
  await page.getByRole('searchbox', { name: '搜索用户' }).fill('no-match')
  await expect(page.getByRole('heading', { name: '没有找到匹配的用户' })).toBeVisible()
})

test('other user space stays read-only, handles empty charts and missing identities', async ({
  page,
}) => {
  await fixture(page)
  await page.goto(`/users/${other}?owner=${owner}`)
  await expect(page.getByRole('heading', { name: '旧账号 的个人空间' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '尚未发布作品' })).toBeVisible()
  await expect(page.getByRole('link', { name: '管理我的账号' })).toHaveCount(0)
  await expect(page.getByTestId('chart-card')).toHaveCount(0)
  await page.goto('/users/missing')
  await expect(page.getByText('用户不存在', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '返回用户广场' })).toBeVisible()
})

for (const [language, title, space] of [
  ['zh-hans', '用户广场', '雨音 Vanilla 的个人空间'],
  ['en', 'Community', '雨音 Vanilla’s space'],
  ['ja', 'ユーザー広場', '雨音 Vanilla のスペース'],
  ['ko', '사용자 광장', '雨音 Vanilla님의 공간'],
]) {
  test(`${language} directory and space fit mobile and dark mode`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await fixture(page, language)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await page.goto('/users')
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await expect(page.getByRole('article')).toHaveCount(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('article').first().getByRole('link').click()
    await expect(page.getByRole('heading', { name: space, exact: true })).toBeVisible()
    await expect(page.getByTestId('chart-card')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: `test-results/user-space-${language}-mobile.png`,
      fullPage: true,
    })
    expect(errors).toEqual([])
  })
}
