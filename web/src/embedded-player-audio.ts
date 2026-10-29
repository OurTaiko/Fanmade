import { playerLoad, type PlayerAudioDecode, type PlayerMode } from './embedded-player-protocol'
import { maxMovie } from './tja'

type Options = {
  audioUrl: string
  // The chart's background movie, when it has one. A movie that fails to download is left out.
  movieUrl?: string
  chartText: string
  course: string
  mode: PlayerMode
  audioType: string
  post: (message: ReturnType<typeof playerLoad>, transfer: Transferable[]) => void
  onRequest: (id: string) => void
  onError: (code: string) => void
}

// One download per load (audio, and the movie alongside). Blobs own the retry bytes after
// postMessage detaches each ArrayBuffer.
export class PlayerAudioLoad {
  private readonly controller = new AbortController()
  private blob: Blob | null = null
  private movie: Blob | null = null
  private id = ''
  private decode: PlayerAudioDecode = 'native'
  private disposed = false
  private awaiting = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly options: Options) {}

  async start() {
    this.begin('native')
    const id = this.id
    const movie = this.downloadMovie()
    try {
      const response = await fetch(this.options.audioUrl, {
        signal: this.controller.signal,
        credentials: 'omit',
        mode: 'cors',
        redirect: 'follow',
      })
      if (!response.ok) throw new Error('AUDIO_DOWNLOAD_FAILED')
      const limit = 100 * 1024 * 1024
      if (Number(response.headers.get('Content-Length')) > limit) throw new Error('AUDIO_TOO_LARGE')
      const blob = await response.blob()
      if (!blob.size || blob.size > limit) throw new Error('INVALID_AUDIO_SIZE')
      const movieBlob = await movie
      if (this.disposed || !this.awaiting || this.controller.signal.aborted || this.id !== id)
        return
      this.blob = blob
      this.movie = movieBlob
      await this.post(id)
    } catch (error) {
      this.fail(error, id)
    }
  }

  // Called only after the component validates the iframe origin and source.
  // Consuming the native error keeps the UI in Loading while the new request runs.
  receive(data: { type: string; requestId?: string; payload?: { code?: string } }): boolean {
    if (this.disposed || !this.awaiting || data.requestId !== this.id) return false
    if (
      data.type === 'error' &&
      data.payload?.code === 'AUDIO_DECODE_FAILED' &&
      this.decode === 'native' &&
      this.blob
    ) {
      this.begin('software') // Change ID/mode synchronously, before another error can arrive.
      const id = this.id
      void this.post(id).catch((error) => this.fail(error, id))
      return true
    }
    if (data.type === 'loaded' || data.type === 'error' || data.type === 'exit') this.finish()
    return false
  }

  dispose() {
    this.disposed = true
    this.controller.abort()
    this.finish()
  }

  private begin(decode: PlayerAudioDecode) {
    this.decode = decode
    this.id = crypto.randomUUID()
    this.awaiting = true
    this.options.onRequest(this.id)
    this.armTimeout('AUDIO_DOWNLOAD_TIMEOUT')
  }

  // The movie is optional, as on upload: any failure plays the chart without it.
  private async downloadMovie(): Promise<Blob | null> {
    const url = this.options.movieUrl
    if (!url) return null
    try {
      const response = await fetch(url, {
        signal: this.controller.signal,
        credentials: 'omit',
        mode: 'cors',
        redirect: 'follow',
      })
      if (!response.ok || Number(response.headers.get('Content-Length')) > maxMovie) return null
      const blob = await response.blob()
      return blob.size && blob.size <= maxMovie ? blob : null
    } catch {
      return null
    }
  }

  private async post(id: string) {
    const bytes = await this.blob!.arrayBuffer()
    const movie = this.movie ? await this.movie.arrayBuffer() : undefined
    if (this.disposed || !this.awaiting || this.id !== id) return
    const o = this.options
    this.armTimeout('AUDIO_DECODE_TIMEOUT')
    const message = playerLoad(
      id,
      o.chartText,
      bytes,
      o.course,
      o.mode,
      o.audioType,
      this.decode,
      movie,
    )
    o.post(message, movie ? [bytes, movie] : [bytes])
  }

  private armTimeout(code: string) {
    clearTimeout(this.timer)
    const id = this.id
    this.timer = setTimeout(() => {
      this.fail(new Error(code), id)
      this.controller.abort()
    }, 120_000)
  }

  private finish() {
    this.awaiting = false
    this.blob = null
    this.movie = null
    clearTimeout(this.timer)
  }

  private fail(error: unknown, id: string) {
    if (this.disposed || !this.awaiting || id !== this.id) return
    this.finish()
    this.options.onError(error instanceof Error ? error.message : 'AUDIO_DOWNLOAD_FAILED')
  }
}
