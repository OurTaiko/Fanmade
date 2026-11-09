import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

// The labels below are the English interface's.
test.use({ locale: 'en-US' })

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
  difficulties: [{ course: 'Oni', side: 'single', level: 5, maker: 'Composer' }],
  score: 0,
  upvotes: 0,
  downvotes: 0,
  commentCount: 0,
  myVote: 0,
}
async function fixture(page: Page, userId: string, initialStatus = 'pending') {
  let status = initialStatus
  // A declined invitation from before this visit; the server keeps them all.
  const invitations: unknown[] = [
    {
      id: 'earlier',
      status: 'declined',
      createdAt: '2026-10-02T00:00:00Z',
      respondedAt: '2026-10-03T00:00:00Z',
      inviter: { id: owner, nickname: 'Original creator' },
      recipient: { id: 'd'.repeat(32), nickname: 'Earlier guest' },
    },
  ]
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
    const revoked = path.match(/\/collaborations\/([^/]+)$/)
    if (revoked && request.method() === 'DELETE') {
      requests.push({ path, body: request.postDataJSON(), csrf: request.headers()['x-csrf-token'] })
      const item = invitations.find((i) => (i as { id: string }).id === revoked[1]) as Record<
        string,
        unknown
      >
      Object.assign(item, {
        status: 'revoked',
        respondedAt: '2026-11-07T01:00:00Z',
        revokedBy: { id: owner, nickname: 'Original creator' },
      })
      return route.fulfill({ json: { status: 'revoked' } })
    }
    if (path.endsWith('/collaborations') && request.method() === 'GET')
      return route.fulfill({ json: { items: invitations } })
    if (path.endsWith('/collaborations')) {
      invitations.unshift({
        id: 'invite',
        status: 'pending',
        createdAt: '2026-11-07T00:00:00Z',
        respondedAt: null,
        inviter: { id: owner, nickname: 'Original creator' },
        recipient: { id: collaborator, nickname: 'Co-creator' },
      })
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
  const history = dialog.getByRole('region', { name: 'Invitations' })
  await expect(history.getByRole('listitem')).toHaveCount(1)
  await expect(history.getByRole('listitem').first()).toContainText('Earlier guest')
  await expect(history.getByRole('listitem').first()).toContainText('Declined')
  await expect(dialog.getByRole('button', { name: 'Send invitation' })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: /Original creator/ })).toBeDisabled()
  await dialog.getByRole('searchbox', { name: 'Search user nicknames' }).fill('Co-creator')
  await dialog.getByRole('button', { name: /Co-creator bbbbb/ }).click()
  await dialog.getByRole('button', { name: 'Send invitation' }).click()
  await expect(
    page.getByText('Invitation sent. The recipient can accept it in notifications.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Got it' }).click()
  // The invitation is listed and the recipient cannot be invited twice.
  await expect(history.getByRole('listitem')).toHaveCount(2)
  await expect(history.getByRole('listitem').first()).toContainText('Co-creator')
  await expect(history.getByRole('listitem').first()).toContainText('Pending')
  await expect(dialog.getByRole('button', { name: /Co-creator bbbbb/ })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  // Reopening still shows it: the record comes from the server.
  await page.getByRole('button', { name: 'Add co-creator', exact: true }).click()
  await expect(history.getByRole('listitem')).toHaveCount(2)
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

test('owner revokes a pending invitation and it stays in the history', async ({ page }) => {
  const requests = await fixture(page, owner)
  await page.goto(`/charts/${chartId}`)
  await page.getByRole('button', { name: 'Add co-creator', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add co-creator', exact: true })
  const history = dialog.getByRole('region', { name: 'Invitations' })
  // Answered invitations cannot be revoked.
  await expect(history.getByRole('button', { name: /Revoke/ })).toHaveCount(0)
  await dialog.getByRole('searchbox', { name: 'Search user nicknames' }).fill('Co-creator')
  await dialog.getByRole('button', { name: /Co-creator bbbbb/ }).click()
  await dialog.getByRole('button', { name: 'Send invitation' }).click()
  await page.getByRole('button', { name: 'Got it' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await history.getByRole('button', { name: 'Revoke the invitation to Co-creator' }).click()
  await expect(page.getByText('Invitation revoked.')).toBeVisible()
  await page.getByRole('button', { name: 'Got it' }).click()
  const first = history.getByRole('listitem').first()
  await expect(first).toContainText('Revoked')
  await expect(first).toContainText('revoked by Original creator')
  await expect(history.getByRole('button', { name: /Revoke/ })).toHaveCount(0)
  // The revoked recipient can be invited again.
  await expect(dialog.getByRole('button', { name: /Co-creator bbbbb/ })).toBeEnabled()
  await history.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/collaboration-revoked-mobile.png' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(requests.map((r) => [r.path, r.csrf])).toEqual([
    [`/api/v1/charts/${chartId}/collaborations`, 'test-csrf'],
    [`/api/v1/charts/${chartId}/collaborations/invite`, 'test-csrf'],
  ])
})

test('recipient sees that a revoked invitation can no longer be answered', async ({ page }) => {
  await fixture(page, collaborator, 'revoked')
  await page.goto('/notifications')
  await expect(page.getByText('This invitation was revoked.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0)
})

test('uploader chooses co-creators while publishing and they are sent with the upload', async ({
  page,
}) => {
  await fixture(page, owner)
  await page.route('**/api/v1/me/charts*', (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } }),
  )
  const uploads: (string | null)[] = []
  await page.route('**/api/v1/charts', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const form = await new Response(route.request().postDataBuffer()!, {
      headers: { 'Content-Type': route.request().headers()['content-type'] },
    }).formData()
    uploads.push(form.get('collaboratorIds') as string | null)
    // The web uploader does not wait, so only the server can send the invitations.
    expect(route.request().headers()['prefer']).toBe('respond-async')
    await route.fulfill({ status: 202, json: { status: 'processing' } })
  })
  await page.goto('/me/charts/publish')
  await page.getByLabel('Choose TJA chart').setInputFiles({
    name: 'chart.tja',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      'TITLE:Together\nBPM:120\nWAVE:cbr.mp3\nCOURSE:Oni\nLEVEL:5\n#START\n1000,\n#END\n',
    ),
  })
  await page.getByLabel('Choose OGG or MP3 audio').setInputFiles({
    name: 'cbr.mp3',
    mimeType: 'audio/mpeg',
    buffer: readFileSync('../kit/audio/testdata/cbr.mp3'),
  })
  await expect(page.getByRole('dialog', { name: 'Local validation passed' })).toBeVisible()
  await page.getByRole('button', { name: 'Got it', exact: true }).click()
  await page.getByRole('tab', { name: 'Co-creators', exact: true }).click()
  const chosen = page.getByRole('region', { name: 'Invited on publishing' })
  await expect(chosen).toContainText('No co-creators selected yet.')
  // The uploader already owns the chart.
  await expect(page.getByRole('button', { name: /Original creator/ })).toBeDisabled()
  const candidate = page.getByRole('button', { name: /Co-creator bbbbb/ })
  await candidate.click()
  await expect(candidate).toHaveAttribute('aria-pressed', 'true')
  await expect(chosen.getByRole('listitem')).toContainText(['Co-creator'])
  // A choice is undone from the list of chosen users or by pressing the user again.
  await chosen.getByRole('button', { name: 'Remove Co-creator' }).click()
  await expect(candidate).toHaveAttribute('aria-pressed', 'false')
  await expect(chosen.getByRole('listitem')).toHaveCount(0)
  await candidate.click()
  await candidate.click()
  await expect(chosen.getByRole('listitem')).toHaveCount(0)
  await candidate.click()
  // The choice survives another search and is shown with the submission.
  await page.getByRole('searchbox', { name: 'Search user nicknames' }).fill('Co')
  // Enter in the search box does not publish the form around it.
  await page.getByRole('searchbox', { name: 'Search user nicknames' }).press('Enter')
  await expect(candidate).toHaveAttribute('aria-pressed', 'true')
  await expect(chosen.getByRole('listitem')).toContainText(['Co-creator'])
  await expect(page.getByTestId('preview-panel')).toContainText('Invited on publishing')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/collaboration-upload-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Publish chart', exact: true }).click()
  await expect(page).toHaveURL('/me/charts')
  expect(uploads).toEqual([JSON.stringify([collaborator])])
})

test('an upload without co-creators sends no invitation field', async ({ page }) => {
  await fixture(page, owner)
  await page.route('**/api/v1/me/charts*', (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } }),
  )
  const uploads: boolean[] = []
  await page.route('**/api/v1/charts', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const form = await new Response(route.request().postDataBuffer()!, {
      headers: { 'Content-Type': route.request().headers()['content-type'] },
    }).formData()
    uploads.push(form.has('collaboratorIds'))
    await route.fulfill({ status: 202, json: { status: 'processing' } })
  })
  await page.goto('/me/charts/publish')
  await page.getByLabel('Choose TJA chart').setInputFiles({
    name: 'chart.tja',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      'TITLE:Together\nBPM:120\nWAVE:cbr.mp3\nCOURSE:Oni\nLEVEL:5\n#START\n1000,\n#END\n',
    ),
  })
  await page.getByLabel('Choose OGG or MP3 audio').setInputFiles({
    name: 'cbr.mp3',
    mimeType: 'audio/mpeg',
    buffer: readFileSync('../kit/audio/testdata/cbr.mp3'),
  })
  await page.getByRole('button', { name: 'Got it', exact: true }).click()
  await page.getByRole('button', { name: 'Publish chart', exact: true }).click()
  await expect(page).toHaveURL('/me/charts')
  expect(uploads).toEqual([false])
})
