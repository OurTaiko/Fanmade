import { expect, test, type Page } from '@playwright/test'

const owner = 'a'.repeat(32)
const collaborator = 'b'.repeat(32)
const chartId = 'c'.repeat(32)
const chart = {
  id: chartId,
  title: 'Together',
  subtitle: '',
  maker: 'Composer',
  bpm: 120,
  offset: 0,
  demoStart: 0,
  wave: 'audio.ogg',
  ownerId: owner,
  ownerIds: [owner],
  owners: [{ id: owner, nickname: 'Original creator' }],
  uploader: 'Original creator',
  categoryIds: [],
  description: 'A shared chart',
  createdAt: '2026-10-01T00:00:00Z',
  duration: 10,
  encoding: 'utf-8',
  tjaName: 'chart.tja',
  audioName: 'audio.ogg',
  tjaHash: 'e'.repeat(64),
  audioHash: 'f'.repeat(64),
  audioSize: 100,
  titleTranslations: {},
  subtitleTranslations: {},
  difficulties: [{ course: 'Oni', level: 5, maker: 'Composer' }],
  score: 0,
  upvotes: 0,
  downvotes: 0,
  commentCount: 0,
  myVote: 0,
}
async function fixture(page: Page, userId: string) {
  let status = 'pending'
  const requests: { path: string; body: unknown; csrf?: string }[] = []
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/v1/me')
      return route.fulfill({
        json: {
          user: {
            id: userId,
            nickname: 'Current user',
            username: 'current',
            preferredLanguage: 'en',
            emailVerified: true,
            isAdmin: false,
          },
          csrfToken: 'test-csrf',
        },
      })
    if (path === '/api/v1/categories') return route.fulfill({ json: { items: [] } })
    if (path === '/api/v1/users')
      return route.fulfill({
        json: {
          items: [
            { id: owner, nickname: 'Original creator' },
            { id: collaborator, nickname: 'Co-creator' },
          ],
          total: 2,
          page: 1,
          pageSize: 12,
          profilesAvailable: true,
        },
      })
    if (path.endsWith('/collaborations')) {
      requests.push({ path, body: request.postDataJSON(), csrf: request.headers()['x-csrf-token'] })
      return route.fulfill({ status: 201, json: { id: 'invite', status: 'pending' } })
    }
    if (path.endsWith('/respond')) {
      requests.push({ path, body: request.postDataJSON(), csrf: request.headers()['x-csrf-token'] })
      status = request.postDataJSON().accept ? 'accepted' : 'declined'
      return route.fulfill({ json: { status } })
    }
    if (path === '/api/v1/me/notifications/unread')
      return route.fulfill({ json: { count: status === 'pending' ? 1 : 0 } })
    if (path === '/api/v1/me/notifications')
      return route.fulfill({
        json: {
          items: [
            {
              id: 'notice',
              kind: 'chart_collaboration',
              createdAt: new Date().toISOString(),
              read: status !== 'pending',
              actor: { id: owner, nickname: 'Original creator' },
              chart: { id: chartId, title: 'Together' },
              comment: null,
              data: { status },
            },
          ],
          total: 1,
          unread: status === 'pending' ? 1 : 0,
          page: 1,
          pageSize: 20,
        },
      })
    if (path === '/api/v1/me/notification-settings') return route.fulfill({ json: { items: [] } })
    if (path === `/api/v1/charts/${chartId}`)
      return route.fulfill({
        json:
          status === 'accepted'
            ? {
                ...chart,
                ownerIds: [owner, collaborator],
                owners: [...chart.owners, { id: collaborator, nickname: 'Co-creator' }],
              }
            : chart,
      })
    if (path.endsWith('/tja'))
      return route.fulfill({
        body: 'TITLE:Together\nBPM:120\nWAVE:audio.ogg\nCOURSE:Oni\nLEVEL:5\n#START\n1000,\n#END\n',
      })
    if (path.endsWith('/audio')) return route.abort()
    if (path.endsWith('/leaderboard') || path.endsWith('/comments'))
      return route.fulfill({
        json: { items: [], total: 0, page: 1, pageSize: 20, supported: true, commentCount: 0 },
      })
    return route.fulfill({ status: 404, json: { message: 'Not found' } })
  })
  return requests
}

test('owner invites a selected co-creator from chart management', async ({ page }) => {
  const requests = await fixture(page, owner)
  await page.goto(`/charts/${chartId}`)
  await page.getByRole('button', { name: 'Add co-creator', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add co-creator', exact: true })
  await expect(dialog.getByRole('button', { name: 'Send invitation' })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: /Original creator/ })).toBeDisabled()
  await dialog.getByRole('searchbox', { name: 'Search user nicknames' }).fill('Co-creator')
  await dialog.getByRole('button', { name: /Co-creator bbbbb/ }).click()
  await dialog.getByRole('button', { name: 'Send invitation' }).click()
  await expect(
    page.getByText('Invitation sent. The recipient can accept it in notifications.'),
  ).toBeVisible()
  expect(requests).toEqual([
    {
      path: `/api/v1/charts/${chartId}/collaborations`,
      body: { userId: collaborator },
      csrf: 'test-csrf',
    },
  ])
})

test('recipient accepts on mobile and gains management with all owners displayed', async ({
  page,
}) => {
  const requests = await fixture(page, collaborator)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/charts/${chartId}`)
  await expect(page.getByRole('button', { name: 'Add co-creator', exact: true })).toHaveCount(0)
  await page.goto('/notifications')
  await expect(page.getByText('Original creator invited you to co-create “Together”')).toBeVisible()
  await page.screenshot({ path: 'test-results/collaboration-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(page.getByText('Accepted. You are now an owner.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0)
  expect(requests).toEqual([
    { path: '/api/v1/me/notifications/notice/respond', body: { accept: true }, csrf: 'test-csrf' },
  ])
  await page.goto(`/charts/${chartId}`)
  await expect(page.getByRole('button', { name: 'Add co-creator', exact: true })).toBeVisible()
  await expect(page.locator(`a[href="/users/${collaborator}"]`)).toBeVisible()
  await expect(page.locator(`a[href="/users/${owner}"]`)).toBeVisible()
})

test('declining leaves chart management unavailable', async ({ page }) => {
  const requests = await fixture(page, collaborator)
  await page.goto('/notifications')
  await page.getByRole('button', { name: 'Decline', exact: true }).click()
  await expect(page.getByText('Declined', { exact: true })).toBeVisible()
  expect(requests[0].body).toEqual({ accept: false })
  await page.goto(`/charts/${chartId}`)
  await expect(page.getByRole('button', { name: 'Add co-creator', exact: true })).toHaveCount(0)
})
