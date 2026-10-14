import { describe, expect, it } from 'vitest'
import { endpoints } from './endpoints'

describe('API addresses', () => {
  it('encodes IDs as path segments for chart, cover and current song resources', () => {
    const id = '曲目/a?b#c'
    const path = `/api/v1/charts/${encodeURIComponent(id)}`
    expect(endpoints.chart(id)).toBe(path)
    expect(endpoints.chartFiles(id)).toBe(`${path}/files`)
    expect(endpoints.cover(id)).toBe(`${path}/cover`)
    const cover = new URL(endpoints.cover(id, 'hash+/?='), 'http://127.0.0.1:5173')
    expect(cover.pathname).toBe(`${path}/cover`)
    expect(cover.searchParams.get('v')).toBe('hash+/?=')
    expect(endpoints.resource({ id }, 'tja')).toBe(`${path}/tja`)
    expect(endpoints.resources(id)).toBe(`${path}/resources`)
  })

  it('preserves nested return URLs and search text without injecting query parameters', () => {
    const returnTo = '/charts/曲目?q=a&next=/me/charts#preview'
    const login = new URL(endpoints.login(returnTo), 'http://127.0.0.1:5173')
    expect([...login.searchParams]).toEqual([['returnTo', returnTo]])
    for (const mine of [false, true]) {
      const list = new URL(
        endpoints.chartList({ q: 'A&B + 太鼓', order: 'hot', page: 2 }, mine),
        login.origin,
      )
      expect(list.pathname).toBe(`/api/v1/${mine ? 'me/charts' : 'charts'}`)
      expect(Object.fromEntries(list.searchParams)).toEqual({
        q: 'A&B + 太鼓',
        order: 'hot',
        page: '2',
      })
    }
    const leaderboard = new URL(
      endpoints.leaderboard('song', { difficultyId: 42, page: 3 }),
      login.origin,
    )
    expect(Object.fromEntries(leaderboard.searchParams)).toEqual({
      difficultyId: '42',
      page: '3',
    })
  })
})
