import { expect, test, type Page } from '@playwright/test'

const me = 'a'.repeat(32)
const other = 'b'.repeat(32)
const chart = (id: string, title: string) => ({
  id,
  title,
  subtitle: '',
  maker: 'Composer',
  bpm: 120,
  offset: 0,
  demoStart: 0,
  wave: 'audio.ogg',
  ownerId: other,
  ownerIds: [other],
  owners: [{ id: other, nickname: 'Curator' }],
  uploader: 'Curator',
  categoryIds: ['game'],
  description: '',
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
  isSingle: true,
  difficulties: [{ course: 'Oni', level: 5, maker: 'Composer' }],
  score: 0,
  upvotes: 0,
  downvotes: 0,
  commentCount: 0,
  myVote: 0,
})
const charts = [chart('c1', 'First song'), chart('c2', 'Second song'), chart('c3', 'Third song')]
const playlist = (id: string, name: string, owner: string, extra = {}) => ({
  id,
  name,
  description: `${name} description`,
  public: true,
  system: false,
  categoryId: 'game',
  genre: 'GAME',
  ownerId: owner,
  owner: { id: owner, nickname: owner === me ? 'Current user' : 'Curator' },
  chartCount: 3,
  favoriteCount: 2,
  favorited: false,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z',
  ...extra,
})
const daily = {
  ...playlist('daily', 'Daily Challenge', ''),
  system: true,
  ownerId: undefined,
  owner: null,
  categoryId: 'variety',
  favoriteCount: 0,
}

async function fixture(page: Page, signedIn = true) {
  const requests: { method: string; path: string; body: unknown; csrf?: string }[] = []
  const owned = [
    playlist('mine', 'My picks', me, { public: false, containsChart: false, chartCount: 3 }),
  ]
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    if (method !== 'GET') {
      let body: unknown = null
      try {
        body = request.postDataJSON()
      } catch {
        body = null
      }
      requests.push({ method, path, body, csrf: request.headers()['x-csrf-token'] })
    }
    if (path === '/api/v1/me')
      return route.fulfill({
        json: signedIn
          ? {
              user: {
                id: me,
                nickname: 'Current user',
                username: 'current',
                preferredLanguage: 'en',
                emailVerified: true,
                isAdmin: false,
              },
              csrfToken: 'test-csrf',
            }
          : { user: null, csrfToken: '' },
      })
    if (path === '/api/v1/categories')
      return route.fulfill({
        json: {
          items: [
            { id: 'game', title: 'Game', genre: 'GAME' },
            { id: 'variety', title: 'Variety', genre: 'VARIETY' },
          ],
        },
      })
    if (path === '/api/v1/me/notifications/unread') return route.fulfill({ json: { count: 0 } })
    if (path === '/api/v1/playlists/system') return route.fulfill({ json: { items: [daily] } })
    if (path === '/api/v1/playlists' && method === 'GET')
      return route.fulfill({
        json: {
          items: [playlist('theirs', 'Festival set', other)],
          total: 1,
          page: 1,
          pageSize: 12,
        },
      })
    if (path === '/api/v1/playlists' && method === 'POST') {
      const body = request.postDataJSON()
      const created = playlist('created', body.name, me, {
        public: !!body.public,
        description: body.description ?? '',
        chartCount: 0,
        favoriteCount: 0,
      })
      owned.unshift({ ...created, containsChart: false })
      return route.fulfill({ status: 201, json: created })
    }
    if (path === '/api/v1/me/playlists')
      return route.fulfill({
        json: {
          owned,
          favorites: [playlist('theirs', 'Festival set', other, { favorited: true })],
          maxPlaylists: 100,
          maxItems: 500,
        },
      })
    if (path === '/api/v1/playlists/theirs/favorite')
      return route.fulfill({ json: { favorited: method === 'PUT', favoriteCount: 3 } })
    if (path.includes('/items/') || path.endsWith('/order'))
      return route.fulfill({ json: { ok: true } })
    if (path === '/api/v1/playlists/mine' && method === 'DELETE')
      return route.fulfill({ json: { ok: true } })
    if (path === '/api/v1/playlists/mine' && method === 'PATCH')
      return route.fulfill({ json: { ...owned.at(-1), ...request.postDataJSON() } })
    if (path === '/api/v1/playlists/mine')
      return route.fulfill({ json: { ...owned.at(-1), charts } })
    if (path === '/api/v1/playlists/theirs')
      return route.fulfill({ json: { ...playlist('theirs', 'Festival set', other), charts } })
    if (path === '/api/v1/playlists/created')
      return route.fulfill({ json: { ...owned[0], charts: [] } })
    if (path === '/api/v1/playlists/daily') return route.fulfill({ json: { ...daily, charts } })
    if (path === '/api/v1/charts/c1') return route.fulfill({ json: charts[0] })
    if (path.endsWith('/tja'))
      return route.fulfill({
        body: 'TITLE:First song\nBPM:120\nWAVE:audio.ogg\nCOURSE:Oni\nLEVEL:5\n#START\n1000,\n#END\n',
      })
    if (path.endsWith('/comments'))
      return route.fulfill({
        json: { items: [], total: 0, commentCount: 0, page: 1, pageSize: 20, sort: 'best' },
      })
    if (path.endsWith('/leaderboard'))
      return route.fulfill({
        json: {
          songId: 'c1',
          difficulty: 'Oni',
          supported: true,
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
        },
      })
    return route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } })
  })
  return requests
}

test('plaza lists system and public playlists and creates one', async ({ page }) => {
  const requests = await fixture(page)
  await page.goto('/playlists')
  await expect(page.getByRole('heading', { name: 'Playlists', level: 1 })).toBeVisible()
  // System playlists are named in the page language, not by the server.
  await expect(page.getByRole('heading', { name: 'Daily Challenge' })).toBeVisible()
  const card = page.getByTestId('playlist-card').filter({ hasText: 'Festival set' })
  await expect(card).toContainText('Curator')
  await expect(card).toContainText('3 songs')
  await expect(card).toContainText('2 favorites')
  await page.screenshot({ path: 'test-results/playlists-plaza.png', fullPage: true })

  await page.getByRole('button', { name: 'New playlist' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'New playlist' })).toBeDisabled()
  await dialog.getByLabel('Playlist name').fill('Road trip')
  await dialog.getByLabel('Description').fill('For the bus')
  await dialog.getByRole('checkbox').click()
  await dialog.getByRole('button', { name: 'New playlist' }).click()
  await expect(page).toHaveURL(/\/playlists\/created$/)
  expect(requests).toEqual([
    {
      method: 'POST',
      path: '/api/v1/playlists',
      body: { name: 'Road trip', description: 'For the bus', categoryId: 'variety', public: true },
      csrf: 'test-csrf',
    },
  ])
  await expect(page.getByText('This playlist has no songs yet.')).toBeVisible()
})

test('the owner arranges and removes songs', async ({ page }) => {
  const requests = await fixture(page)
  await page.goto('/playlists/mine')
  await expect(page.getByRole('heading', { name: 'My picks', level: 1 })).toBeVisible()
  await expect(page.getByText('Private')).toBeVisible()
  await expect(page.getByTestId('chart-card')).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Favorite' })).toHaveCount(0)
  await page.screenshot({ path: 'test-results/playlists-detail.png', fullPage: true })

  await page.getByRole('button', { name: 'Arrange songs' }).click()
  await page.getByRole('button', { name: 'Move "Third song" up' }).click()
  const rows = page.locator('ol > li')
  await expect(rows.nth(1)).toContainText('Third song')
  await page.getByRole('button', { name: 'Remove "First song" from the playlist' }).click()
  await expect(rows).toHaveCount(2)
  await page.screenshot({ path: 'test-results/playlists-arrange.png', fullPage: true })
  expect(requests).toEqual([
    {
      method: 'PUT',
      path: '/api/v1/playlists/mine/order',
      body: { chartIds: ['c1', 'c3', 'c2'] },
      csrf: 'test-csrf',
    },
    { method: 'DELETE', path: '/api/v1/playlists/mine/items/c1', body: null, csrf: 'test-csrf' },
  ])
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('chart-card')).toHaveCount(2)

  await page.getByRole('button', { name: 'Delete playlist' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm deletion' }).click()
  await expect(page).toHaveURL(/\/me\/playlists$/)
})

test('a visitor favorites a playlist; system playlists are read-only', async ({ page }) => {
  const requests = await fixture(page)
  await page.goto('/playlists/theirs')
  await expect(page.getByRole('button', { name: 'Edit playlist' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Favorite', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Unfavorite' })).toBeVisible()
  await expect(page.getByText('3 favorites')).toBeVisible()
  expect(requests[0]).toMatchObject({ method: 'PUT', path: '/api/v1/playlists/theirs/favorite' })

  await page.goto('/playlists/daily')
  await expect(page.getByRole('heading', { name: 'Daily Challenge', level: 1 })).toBeVisible()
  await expect(page.getByText('System playlist')).toBeVisible()
  for (const name of ['Favorite', 'Edit playlist', 'Delete playlist'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)

  await page.goto('/me/playlists')
  await expect(page.getByRole('heading', { name: 'Created by me' })).toBeVisible()
  await expect(page.getByTestId('playlist-card')).toHaveCount(2)
})

test('a song is added to playlists from its page', async ({ page }) => {
  const requests = await fixture(page)
  await page.goto('/charts/c1')
  await page.getByRole('button', { name: 'Add to playlist' }).click()
  const dialog = page.getByRole('dialog')
  const mine = dialog.getByRole('button', { name: /My picks/ })
  await expect(mine).toHaveAttribute('aria-pressed', 'false')
  await mine.click()
  await expect(mine).toHaveAttribute('aria-pressed', 'true')
  await expect(mine).toContainText('4 songs')
  await dialog.getByLabel('New playlist name').fill('Fresh')
  await dialog.getByRole('button', { name: 'Create and add' }).click()
  await expect(dialog.getByRole('button', { name: /Fresh/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.screenshot({ path: 'test-results/playlists-add.png' })
  expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
    'PUT /api/v1/playlists/mine/items/c1',
    'POST /api/v1/playlists',
    'PUT /api/v1/playlists/created/items/c1',
  ])
})

test('guests browse playlists without account actions', async ({ page }) => {
  await fixture(page, false)
  await page.goto('/playlists')
  await expect(page.getByTestId('playlist-card').filter({ hasText: 'Festival set' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New playlist' })).toHaveCount(0)
  await page.goto('/me/playlists')
  await expect(page.getByText('Sign in to create and favorite playlists.')).toBeVisible()
  await page.goto('/charts/c1')
  await expect(page.getByRole('heading', { name: 'First song', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add to playlist' })).toHaveCount(0)
})
