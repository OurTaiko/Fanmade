import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlayerAudioLoad } from './embedded-player-audio'
import type { playerLoad } from './embedded-player-protocol'

const loads: PlayerAudioLoad[] = []
afterEach(() => {
  loads.splice(0).forEach((load) => load.dispose())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function setup(movieUrl?: string) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([79, 103, 103, 83, 1])))
  vi.stubGlobal('fetch', fetchMock)
  const sent: ReturnType<typeof playerLoad>[] = []
  const onRequest = vi.fn()
  const onError = vi.fn()
  const load = new PlayerAudioLoad({
    audioUrl: 'https://assets.example/song.ogg',
    movieUrl,
    chartText: 'TITLE:test\n#START\n1000,\n#END',
    course: 'Oni',
    mode: 'auto',
    audioType: 'ogg',
    post: (message, transfer) => {
      sent.push(structuredClone(message, { transfer }))
      expect(message.payload.audioBytes.byteLength).toBe(0)
      if (message.payload.movieBytes) expect(message.payload.movieBytes.byteLength).toBe(0)
    },
    onRequest,
    onError,
  })
  loads.push(load)
  return { load, sent, fetchMock, onRequest, onError }
}

const failure = (requestId: string, code = 'AUDIO_DECODE_FAILED') => ({
  type: 'error',
  requestId,
  payload: { code },
})

describe('embedded audio loading', () => {
  it('downloads once and re-posts intact Blob bytes with a new ID and software mode', async () => {
    const { load, sent, fetchMock, onError } = setup()
    await load.start()
    expect(sent[0].payload.audioDecode).toBe('native')
    expect(load.receive(failure(sent[0].requestId))).toBe(true)
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sent[1].requestId).not.toBe(sent[0].requestId)
    expect(sent[1].payload).toEqual({ ...sent[0].payload, audioDecode: 'software' })
    expect(onError).not.toHaveBeenCalled()
  })

  it('ignores duplicate/stale errors and never retries a failed software attempt', async () => {
    const { load, sent, fetchMock } = setup()
    await load.start()
    const original = sent[0].requestId
    expect(load.receive(failure(original))).toBe(true)
    expect(load.receive(failure(original))).toBe(false)
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    expect(load.receive(failure(sent[1].requestId))).toBe(false)
    expect(load.receive(failure(sent[1].requestId))).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sent).toHaveLength(2)
  })

  it('does not retry unrelated errors or a request from an old chart', async () => {
    const { load, sent } = setup()
    await load.start()
    expect(load.receive(failure('old-chart'))).toBe(false)
    expect(load.receive(failure(sent[0].requestId, 'INVALID_CHART'))).toBe(false)
    expect(load.receive(failure(sent[0].requestId))).toBe(false)
    expect(sent).toHaveLength(1)
  })

  it('releases retry data on loaded and on exit', async () => {
    for (const type of ['loaded', 'exit']) {
      const { load, sent } = setup()
      await load.start()
      load.receive({ type, requestId: sent[0].requestId })
      expect(load.receive(failure(sent[0].requestId))).toBe(false)
      expect(sent).toHaveLength(1)
    }
  })

  it('does not post a retry whose Blob conversion completes after close', async () => {
    const { load, sent } = setup()
    await load.start()
    let resolve!: (buffer: ArrayBuffer) => void
    vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    load.receive(failure(sent[0].requestId))
    load.dispose()
    resolve(new ArrayBuffer(5))
    await Promise.resolve()
    expect(sent).toHaveLength(1)
  })

  it('aborts the initial download on dispose without showing a stale error', async () => {
    const { load, sent, fetchMock, onError } = setup()
    let finish!: (response: Response) => void
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = load.start()
    load.dispose()
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    finish(new Response(new Uint8Array([1])))
    await pending
    expect(sent).toHaveLength(0)
    expect(onError).not.toHaveBeenCalled()
  })

  it('terminates a silent player without an unbounded retry', async () => {
    vi.useFakeTimers()
    const { load, sent, onError } = setup()
    await load.start()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(onError).toHaveBeenCalledWith('AUDIO_DECODE_TIMEOUT')
    expect(load.receive(failure(sent[0].requestId))).toBe(false)
  })

  it('rejects empty audio without posting or retrying', async () => {
    const { load, sent, fetchMock, onError } = setup()
    fetchMock.mockResolvedValue(new Response(new Blob()))
    await load.start()
    expect(onError).toHaveBeenCalledWith('INVALID_AUDIO_SIZE')
    expect(sent).toHaveLength(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('downloads the movie alongside and transfers it with every attempt', async () => {
    const { load, sent, fetchMock } = setup('https://assets.example/movie')
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        new Response(new Uint8Array(url.endsWith('/movie') ? [0, 0, 0, 24, 102] : [79, 103, 103])),
      ),
    )
    await load.start()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(new Uint8Array(sent[0].payload.movieBytes!)).toEqual(new Uint8Array([0, 0, 0, 24, 102]))
    expect(load.receive(failure(sent[0].requestId))).toBe(true)
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    expect(new Uint8Array(sent[1].payload.movieBytes!)).toEqual(new Uint8Array([0, 0, 0, 24, 102]))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('plays without a movie that is missing or fails to download', async () => {
    for (const movie of [
      () => Promise.resolve(new Response('', { status: 404 })),
      () => Promise.reject(new TypeError('network')),
      () => Promise.resolve(new Response(new Blob())),
    ]) {
      const { load, sent, fetchMock, onError } = setup('https://assets.example/movie')
      fetchMock.mockImplementation((url: string) =>
        url.endsWith('/movie') ? movie() : Promise.resolve(new Response(new Uint8Array([79]))),
      )
      await load.start()
      expect(sent).toHaveLength(1)
      expect(sent[0].payload).not.toHaveProperty('movieBytes')
      expect(onError).not.toHaveBeenCalled()
    }
  })
})
