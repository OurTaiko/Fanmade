import { test, expect } from '@playwright/test'
import type { Chart } from '../src/api/types'
import { selectValue } from './ui-helpers'
const chart: Chart = {
  id: '1'.repeat(32),
  ownerId: 'fixture-user',
  uploader: 'tester',
  title: '普通谱面预览',
  subtitle: '',
  maker: 'tester',
  bpm: 120,
  offset: 0,
  demoStart: 0,
  wave: 'music.ogg',
  description: '',
  createdAt: '2026-09-14T12:00:00Z',
  duration: 10,
  encoding: 'utf-8',
  tjaName: 'chart.tja',
  audioName: 'music.ogg',
  tjaHash: 'a'.repeat(64),
  audioHash: 'b'.repeat(64),
  audioSize: 100,
  titleTranslations: {},
  subtitleTranslations: {},
  score: 0,
  upvotes: 0,
  downvotes: 0,
  commentCount: 0,
  myVote: 0,
  difficulties: ['Easy', 'Normal', 'Hard', 'Oni', 'Edit'].map((course, blockIndex) => ({
    course,

    level: 5,

    maker: '',
  })),
}

for (const signedIn of [false, true]) {
  test(`keyword and order survive pagination with the owner filter (${signedIn ? 'member' : 'guest'})`, async ({
    page,
  }) => {
    const requests: URL[] = []
    await page.route('**/api/v1/**', (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/v1/me')
        return route.fulfill({
          json: {
            user: signedIn
              ? { id: 'fixture-user', nickname: '测试用户', language: 'zh-Hans', isAdmin: false }
              : null,
            csrfToken: '',
          },
        })
      if (url.pathname === '/api/v1/charts') {
        requests.push(url)
        return route.fulfill({
          json: {
            items: [chart],
            total: 25,
            page: Number(url.searchParams.get('page') || 1),
            pageSize: 12,
          },
        })
      }
      return route.fulfill({ json: { items: [] } })
    })
    await page.goto('/?owner=fixture-user')
    // The website filters by difficulty and star too; completion filters stay the game's.
    await expect(page.getByRole('combobox', { name: '难度' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: '星级' })).toBeVisible()
    await page.getByRole('combobox', { name: '显示顺序' }).click()
    await expect(page.locator('[data-slot="select-item"]')).toHaveText([
      '最新发布',
      '热门',
      '最高分',
      '讨论最多',
      '最近更改',
    ])
    // Pick from the open menu; closing and reopening it races its animation.
    await page.locator('[data-slot="select-item"][data-value="hot"]').click()
    await expect(page.getByRole('heading', { name: /^热门/ })).toBeVisible()
    await page.getByRole('searchbox').fill('太鼓 & test')
    await expect.poll(() => requests.at(-1)?.searchParams.get('q')).toBe('太鼓 & test')
    await page.getByRole('button', { name: '下一页', exact: true }).click()
    await expect.poll(() => requests.at(-1)?.searchParams.get('page')).toBe('2')
    expect(Object.fromEntries(requests.at(-1)!.searchParams)).toEqual({
      q: '太鼓 & test',
      order: 'hot',
      owner: 'fixture-user',
      page: '2',
    })
    await page.reload()
    await expect(page.getByRole('combobox', { name: '显示顺序' })).toHaveAttribute(
      'data-value',
      'hot',
    )
    await selectValue(page, '显示顺序', 'top')
    await expect.poll(() => requests.at(-1)?.searchParams.get('order')).toBe('top')
    expect(requests.at(-1)?.searchParams.get('page')).toBe('1')
    await page.goBack()
    await expect(page.getByRole('combobox', { name: '显示顺序' })).toHaveAttribute(
      'data-value',
      'hot',
    )
    await selectValue(page, '显示顺序', '')
    // The default order is not sent.
    await expect.poll(() => requests.at(-1)?.searchParams.get('order')).toBeNull()
    expect(Object.fromEntries(requests.at(-1)!.searchParams)).toEqual({
      q: '太鼓 & test',
      owner: 'fixture-user',
      page: '1',
    })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  })
}
