import { useTranslation } from 'react-i18next'
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import {
  PauseIcon as Pause,
  PlayIcon as Play,
  SpeakerHighIcon as Volume2,
  SpeakerSlashIcon as VolumeX,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

function time(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, '0')}`
}

type AudioPlayerProps = {
  src: string
  label: string
  startAt?: number
  endAt?: number
  disabled?: boolean
  /** Server-measured length; preferred over the browser's (Safari misreads some Ogg files). */
  knownDuration?: number
  /** Inline variant: label and time share one row above the track. */
  compact?: boolean
  className?: string
  onPlayingChange?: (playing: boolean) => void
  ref?: Ref<AudioPlayerHandle>
}

export type AudioPlayerHandle = {
  toggle: () => Promise<void>
}

export function AudioPlayer(props: AudioPlayerProps) {
  return <AudioPlayerContent key={props.src} {...props} />
}

function AudioPlayerContent({
  src,
  label,
  startAt = 0,
  endAt,
  disabled = false,
  knownDuration,
  compact = false,
  className,
  onPlayingChange,
  ref,
}: AudioPlayerProps) {
  const { t } = useTranslation()

  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [mediaDuration, setMediaDuration] = useState(0)
  const known =
    knownDuration !== undefined && Number.isFinite(knownDuration) && knownDuration > 0
      ? knownDuration
      : undefined
  const duration = known ?? mediaDuration
  const [position, setPosition] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState('')
  const range = endAt !== undefined
  const rangeStart = Number.isFinite(startAt) ? Math.max(0, startAt) : 0
  const rangeEnd = range ? Math.min(endAt, duration || endAt) : duration
  const validRange =
    !range ||
    (Number.isFinite(startAt) && Number.isFinite(endAt) && startAt >= 0 && rangeEnd > startAt)
  useEffect(() => {
    const player = audio.current
    if (!player || endAt === undefined) return
    player.pause()
    if (player.readyState >= 1 && Number.isFinite(startAt)) {
      player.currentTime = Math.max(0, Math.min(startAt, known ?? player.duration))
    }
  }, [startAt, endAt, known])
  useEffect(() => {
    const player = audio.current
    return () => {
      player?.pause()
    }
  }, [])
  useEffect(() => {
    if (!range || !validRange || !playing) return
    const timer = window.setInterval(() => {
      const player = audio.current
      if (player && player.currentTime >= rangeEnd) {
        player.pause()
        player.currentTime = rangeEnd
      }
    }, 25)
    return () => window.clearInterval(timer)
  }, [range, validRange, playing, rangeEnd])
  const playingChange = useRef(onPlayingChange)
  useEffect(() => {
    playingChange.current = onPlayingChange
  })
  useEffect(() => {
    playingChange.current?.(playing)
  }, [playing])
  const toggle = async () => {
    const player = audio.current
    if (!player || disabled || !validRange) return
    if (!player.paused) {
      player.pause()
      return
    }
    try {
      setError('')
      if (range) player.currentTime = rangeStart
      await player.play()
    } catch {
      setError(t('messages.cannotPlayAudioRightNowPleaseRetry'))
    }
  }
  useImperativeHandle(ref, () => ({ toggle }))
  const shownEnd = time(range && validRange ? rangeEnd : duration)
  return (
    <div
      className={cn(
        compact
          ? 'space-y-2 rounded-xl border bg-card py-2.5 pr-3.5 pl-2.5'
          : 'space-y-3 rounded-2xl border p-4',
        className,
      )}
      role="group"
      aria-label={label}
    >
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(event) => {
          const player = event.currentTarget
          if (!Number.isFinite(player.duration)) return
          setMediaDuration(player.duration)
          player.currentTime = Math.max(0, Math.min(rangeStart, known ?? player.duration))
          setPosition(player.currentTime)
        }}
        onSeeked={(event) => setPosition(event.currentTarget.currentTime)}
        onTimeUpdate={(event) => {
          const player = event.currentTarget
          if (range && validRange && player.currentTime >= rangeEnd) {
            player.pause()
            if (player.currentTime > rangeEnd) player.currentTime = rangeEnd
          }
          setPosition(player.currentTime)
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => {
          setPlaying(false)
          setError(t('messages.failedToLoadAudioCheckYourConnectionAndRetry'))
        }}
      />
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="icon"
          variant={compact ? 'default' : 'secondary'}
          className={compact ? 'size-11 shrink-0 rounded-full' : undefined}
          aria-label={playing ? t('messages.pauseAudio') : t('messages.playAudio')}
          disabled={disabled || !validRange || (range && !duration)}
          onClick={() => void toggle()}
        >
          {playing ? <Pause /> : <Play />}
        </Button>
        <div className="min-w-0 flex-1 space-y-2">
          {compact && (
            <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
              <span className="truncate font-medium text-foreground">{label}</span>
              <span className="shrink-0 tabular-nums">
                {time(position)} / {shownEnd}
              </span>
            </div>
          )}
          <Slider
            aria-label={t('messages.playbackProgress', { label: label })}
            value={[
              range && validRange ? Math.max(rangeStart, Math.min(position, rangeEnd)) : position,
            ]}
            min={range && validRange ? rangeStart : 0}
            max={range && validRange ? rangeEnd : duration || 1}
            step={0.1}
            disabled={disabled || !duration || !validRange}
            onValueChange={(value) => {
              const next = typeof value === 'number' ? value : value[0]
              if (audio.current) audio.current.currentTime = next
              setPosition(next)
            }}
          />
          {!compact && (
            <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
              <span>{time(position)}</span>
              <span>{shownEnd}</span>
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={muted ? t('messages.unmute') : t('messages.mute')}
          onClick={() => {
            if (audio.current) audio.current.muted = !muted
            setMuted(!muted)
          }}
        >
          {muted || !volume ? <VolumeX /> : <Volume2 />}
        </Button>
        <Slider
          className="hidden w-20! sm:block"
          aria-label={t('messages.volume')}
          value={[muted ? 0 : volume]}
          min={0}
          max={1}
          step={0.05}
          onValueChange={(value) => {
            const next = typeof value === 'number' ? value : value[0]
            if (audio.current) {
              audio.current.volume = next
              audio.current.muted = false
            }
            setVolume(next)
            setMuted(false)
          }}
        />
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
