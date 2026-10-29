import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { endpoints } from '@/api/endpoints'
import type { Chart } from '@/api/types'
import { resolvePlayerUrl } from './embedded-player-source'
import { PlayerAudioLoad } from './embedded-player-audio'
import {
  defaultDrumVolume,
  isPlayerMessage,
  playerChannel,
  playerDrumVolume,
  type PlayerMode,
} from './embedded-player-protocol'

const playerManifestUrl = 'https://distrib.ourtaiko.org/player-build.json'

export default function EmbeddedPlayer({
  chart,
  source,
  course,
}: {
  chart: Chart
  source: string
  course: string
}) {
  const { t } = useTranslation()
  const chartId = chart.id
  const audioType = chart.audioName.split('.').pop()?.toLowerCase() || 'ogg'
  const hasMovie = Boolean(chart.movieHash)
  const iframe = useRef<HTMLIFrameElement>(null)
  const request = useRef('')
  const audioLoad = useRef<PlayerAudioLoad | null>(null)
  const [mode, setMode] = useState<PlayerMode | null>(null)
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [drumVolume, setDrumVolume] = useState(defaultDrumVolume)
  const drumVolumeRef = useRef(defaultDrumVolume)
  const [playerUrl, setPlayerUrl] = useState('')
  const playerOrigin = playerUrl ? new URL(playerUrl).origin : window.location.origin
  const opened = mode !== null

  useEffect(() => {
    if (!opened) return
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 30_000)
    async function resolvePlayer() {
      try {
        const url = await resolvePlayerUrl({
          manifestUrl: playerManifestUrl,
          parentOrigin: window.location.origin,
          signal: controller.signal,
        })
        if (!controller.signal.aborted) setPlayerUrl(url)
      } catch {
        if (!disposed) {
          setError('PLAYER_MANIFEST_UNAVAILABLE')
          setStatus('error')
        }
      } finally {
        window.clearTimeout(timeout)
      }
    }
    let disposed = false
    void resolvePlayer()
    return () => {
      disposed = true
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [opened, attempt])
  const send = useCallback(
    (type: string) => {
      iframe.current?.contentWindow?.postMessage(
        { channel: playerChannel, type, requestId: request.current },
        playerOrigin,
      )
    },
    [playerOrigin],
  )
  const sendDrumVolume = useCallback(
    (volume: number) => {
      iframe.current?.contentWindow?.postMessage(
        playerDrumVolume(request.current, volume),
        playerOrigin,
      )
    },
    [playerOrigin],
  )

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (!isPlayerMessage(event, iframe.current?.contentWindow ?? null, playerOrigin)) return
      const data = event.data
      if (data.type === 'ready') {
        // A new or reloaded player starts at the default; keep the chosen volume.
        sendDrumVolume(drumVolumeRef.current)
        setReady(true)
        return
      }
      if (data.requestId && data.requestId !== request.current) return
      if (audioLoad.current?.receive(data)) return
      if (data.type === 'error') {
        setError(
          data.payload?.detail
            ? `${data.payload.code}: ${data.payload.detail}`
            : data.payload?.code || 'PLAYER_ERROR',
        )
        setStatus('error')
      } else if (data.type === 'exit') {
        audioLoad.current?.dispose()
        setMode(null)
        setPlayerUrl('')
        setReady(false)
        setStatus('idle')
      } else if (['loading', 'loaded', 'finished'].includes(data.type)) setStatus(data.type)
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [playerOrigin, sendDrumVolume])

  useEffect(() => {
    if (!ready || !mode || !source) return
    const audio = new URL(endpoints.resource({ id: chartId }, 'audio'), window.location.href).href
    const movie = hasMovie
      ? new URL(endpoints.resource({ id: chartId }, 'movie'), window.location.href).href
      : undefined
    const load = new PlayerAudioLoad({
      audioUrl: audio,
      movieUrl: movie,
      chartText: source,
      course,
      mode,
      audioType,
      post: (message, transfer) => {
        const target = iframe.current?.contentWindow
        if (!target) throw new Error('PLAYER_UNAVAILABLE')
        target.postMessage(message, playerOrigin, transfer)
      },
      onRequest: (id) => {
        request.current = id
        setError('')
        setStatus('loading')
      },
      onError: (code) => {
        setError(code)
        setStatus('error')
      },
    })
    audioLoad.current = load
    void load.start()
    return () => {
      load.dispose()
      if (audioLoad.current === load) audioLoad.current = null
      request.current = ''
    }
  }, [ready, mode, source, chartId, course, playerOrigin, audioType, hasMovie])

  useEffect(() => {
    if (!mode || ready || error) return
    const timeout = window.setTimeout(() => {
      setError('PLAYER_BOOT_TIMEOUT')
      setStatus('error')
    }, 120_000)
    return () => window.clearTimeout(timeout)
  }, [mode, ready, error, attempt])

  function choose(value: PlayerMode) {
    if (mode && mode !== value) send('pause')
    setMode(value)
  }
  function reload() {
    audioLoad.current?.dispose()
    setPlayerUrl('')
    setReady(false)
    setError('')
    setStatus('loading')
    setAttempt((n) => n + 1)
  }
  return (
    <section className="space-y-4" aria-label={t('messages.chartPreview')}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={mode === 'practice' ? 'default' : 'outline'}
          disabled={!source || status === 'loading'}
          onClick={() => choose('practice')}
        >
          {t('messages.playerPractice')}
        </Button>
        <Button
          variant={mode === 'auto' ? 'default' : 'outline'}
          disabled={!source || status === 'loading'}
          onClick={() => choose('auto')}
        >
          {t('messages.playerWatch')}
        </Button>
        {mode && (
          <Button
            variant="ghost"
            onClick={() => {
              audioLoad.current?.dispose()
              send('unload')
              setMode(null)
              setPlayerUrl('')
              setReady(false)
              setStatus('idle')
              setError('')
            }}
          >
            {t('messages.playerClose')}
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{t('messages.playerHelp')}</p>
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <span>
            {t('messages.playerFailed')} ({error})
          </span>
          <Button variant="outline" onClick={reload}>
            {t('messages.reload')}
          </Button>
        </div>
      )}
      {mode && (
        <Button
          variant="outline"
          onClick={() => {
            void iframe.current?.requestFullscreen().catch(() => setError('FULLSCREEN_UNAVAILABLE'))
          }}
        >
          {t('messages.playerFullscreen')}
        </Button>
      )}
      {mode && (
        <div className="flex max-w-sm items-center gap-3 text-sm">
          <span className="shrink-0">{t('messages.playerDrumVolume')}</span>
          <Slider
            aria-label={t('messages.playerDrumVolume')}
            value={[drumVolume]}
            min={0}
            max={100}
            step={1}
            onValueChange={(value) => {
              const next = typeof value === 'number' ? value : value[0]
              drumVolumeRef.current = next
              setDrumVolume(next)
              sendDrumVolume(next)
            }}
          />
          <span className="w-9 shrink-0 text-right tabular-nums">{drumVolume}</span>
        </div>
      )}
      {status === 'finished' && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('messages.playerFinished')}
        </p>
      )}
      {mode && playerUrl ? (
        <iframe
          key={attempt}
          ref={iframe}
          src={playerUrl}
          title={t('messages.chartPreview')}
          className="aspect-video w-full rounded-xl border bg-black"
          allow="autoplay; fullscreen"
          allowFullScreen
          onLoad={() => send('hello')}
        />
      ) : (
        <div className="flex min-h-40 items-center justify-center rounded-xl bg-muted/40 p-6 text-sm text-muted-foreground">
          {t('messages.playerChoose')}
        </div>
      )}
    </section>
  )
}
