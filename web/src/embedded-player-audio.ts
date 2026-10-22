import { playerLoad, type PlayerAudioDecode, type PlayerMode } from './embedded-player-protocol'

type Options = {
  audioUrl: string
  chartText: string
  course: string
  mode: PlayerMode
  audioType: string
  post: (message: ReturnType<typeof playerLoad>, transfer: Transferable[]) => void
  onRequest: (id: string) => void
  onError: (code: string) => void
}

// One download per load. Blob owns the retry bytes after postMessage detaches each ArrayBuffer.
export class PlayerAudioLoad {
  private readonly controller = new AbortController()
  private blob: Blob | null = null
  private id = ''
  private decode: PlayerAudioDecode = 'native'
  private disposed = false
  private awaiting = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly options: Options) {}

  async start() {
    this.begin('native')
    const id = this.id
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
      if (this.disposed || !this.awaiting || this.controller.signal.aborted || this.id !== id)
        return
      this.blob = blob
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

  private async post(id: string) {
    const bytes = await this.blob!.arrayBuffer()
    if (this.disposed || !this.awaiting || this.id !== id) return
    const o = this.options
    this.armTimeout('AUDIO_DECODE_TIMEOUT')
    o.post(playerLoad(id, o.chartText, bytes, o.course, o.mode, o.audioType, this.decode), [bytes])
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
    clearTimeout(this.timer)
  }

  private fail(error: unknown, id: string) {
    if (this.disposed || !this.awaiting || id !== this.id) return
    this.finish()
    this.options.onError(error instanceof Error ? error.message : 'AUDIO_DOWNLOAD_FAILED')
  }
}
