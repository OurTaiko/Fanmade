import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { i18n } from '../i18n'
import { api, ApiError, jsonRequest } from './client'
import { endpoints } from './endpoints'

afterEach(() => vi.unstubAllGlobals())
beforeEach(async () => {
  await i18n.changeLanguage('zh-Hans')
})

it('requests the endpoint once with cookies, CSRF and cancellation intact', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'song' })))
  vi.stubGlobal('fetch', fetch)
  const controller = new AbortController()
  const request = {
    ...jsonRequest('PATCH', { description: '更新' }, 'csrf'),
    signal: controller.signal,
  }
  expect(await api(endpoints.chart('song'), request)).toEqual({ id: 'song' })
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/v1/charts/song', {
    credentials: 'include',
    ...request,
  })
})

it('preserves API retry information and non-JSON upload size errors', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ message: '稍后重试' }), {
        status: 429,
        headers: { 'Retry-After': '12' },
      }),
    )
    .mockResolvedValueOnce(new Response('Request Entity Too Large', { status: 413 }))
  vi.stubGlobal('fetch', fetch)
  await expect(api(endpoints.charts)).rejects.toMatchObject({ message: '稍后重试', retryAfter: 12 })
  await expect(api(endpoints.charts)).rejects.toEqual(new ApiError('文件超过上传大小限制'))
})
