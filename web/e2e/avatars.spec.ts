import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Chart, PublicUser } from '../src/api/types'

// Fully mocked: SSO avatars are cross-origin images served by the account center.
const sso = 'https://sso.example.test'
const owner = 'a'.repeat(32)
const player = 'b'.repeat(32)
const avatar = (id: string, digest: string) => `${sso}/avatars/${id}/${digest.repeat(32)}.webp`
const ownerAvatar = avatar(owner, '1')
const playerAvatar = avatar(player, '2')
const brokenAvatar = avatar(owner, '3')
// 1×1 PNG; the browser decodes by content, not by the .webp extension.
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)
const member: PublicUser = {
  id: owner,
  nickname: '雨音 Vanilla',
  avatarUrl: ownerAvatar,
  firstLoginAt: '2026-09-01T12:00:00Z',
  lastActiveAt: '2026-09-24T10:00:00Z',
  chartCount: 1,
  scoreCount: 1,
}
const chart: Chart = {
  id: 'c'.repeat(32),
  title: '头像测试曲',
  subtitle: '',
  maker: '',
  bpm: 120,
  offset: 0,
  demoStart: 0,
  wave: 'audio.ogg',
  ownerId: owner,
  uploader: member.nickname!,
  uploaderAvatarUrl: ownerAvatar,
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
  difficulties: [{ course: 'Oni', level: 8, maker: '' }],
}

async function fixture(page: Page, meAvatar: string) {
  await page.route(`${sso}/avatars/**`, (route) =>
    route.request().url() === brokenAvatar
      ? route.fulfill({ status: 404 })
      : route.fulfill({ body: pixel, contentType: 'image/png' }),
  )
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/me')
      return route.fulfill({
        json: {
          user: {
            id: owner,
            username: 'vanilla',
            nickname: member.nickname,
            avatarUrl: meAvatar,
            emailVerified: true,
            isAdmin: false,
          },
          csrfToken: 'csrf',
        },
      })
    if (path === '/api/v1/categories') return route.fulfill({ json: { items: [] } })
    if (path === `/api/v1/charts/${chart.id}`) return route.fulfill({ json: chart })
    if (path.endsWith('/tja'))
      return route.fulfill({ body: 'TITLE:t\nBPM:120\nCOURSE:3\nLEVEL:8\n#START\n1111,\n#END' })
    if (path.endsWith('/leaderboard'))
      return route.fulfill({
        json: {
          songId: chart.id,
          difficulty: 'Oni',
          supported: true,
          total: 2,
          page: 1,
          pageSize: 20,
          items: [
            [player, '太鼓达人', playerAvatar, 1000000],
            [owner, member.nickname, '', 900000],
          ].map(([userId, nickname, avatarUrl, score], i) => ({
            id: `entry${i}`,
            userId,
            nickname,
            avatarUrl,
            rank: i + 1,
            score,
            good: 300,
            ok: 0,
            bad: 0,
            drumroll: 0,
            submittedAt: '2026-09-13T12:00:00Z',
          })),
        },
      })
    if (path === '/api/v1/users')
      return route.fulfill({
        json: { items: [member], total: 1, page: 1, pageSize: 12, profilesAvailable: true },
      })
    return route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } })
  })
}

const avatarImage = (scope: ReturnType<Page['locator']>) =>
  scope.locator('[data-slot=avatar-image]')
const fallback = (scope: ReturnType<Page['locator']>) =>
  scope.locator('[data-slot=avatar-fallback]')

test('uploader, leaderboard and member cards show SSO avatars with initial fallback', async ({
  page,
}) => {
  await fixture(page, ownerAvatar)
  await page.goto(`/charts/${chart.id}`)
  const uploader = page.locator('dd').getByRole('link', { name: member.nickname! })
  await expect(avatarImage(uploader)).toHaveAttribute('src', ownerAvatar)
  await expect(avatarImage(page.locator('header'))).toHaveAttribute('src', ownerAvatar)

  await page.getByRole('tab', { name: '排行榜', exact: true }).click()
  const withAvatar = page.getByRole('rowheader', { name: '太鼓达人' })
  await expect(avatarImage(withAvatar)).toHaveAttribute('src', playerAvatar)
  const withoutAvatar = page.getByRole('rowheader', { name: member.nickname! })
  await expect(avatarImage(withoutAvatar)).toHaveCount(0)
  await expect(fallback(withoutAvatar)).toHaveText('雨')

  await page.goto('/users')
  const card = page.getByRole('article', { name: member.nickname! })
  await expect(avatarImage(card)).toHaveAttribute('src', ownerAvatar)
})

test('a failing avatar keeps the nickname initial', async ({ page }) => {
  await fixture(page, brokenAvatar)
  await page.goto('/me/profile')
  const header = page.locator('header')
  await expect(fallback(header)).toHaveText('雨')
  await expect(avatarImage(header)).toHaveCount(0)
})
