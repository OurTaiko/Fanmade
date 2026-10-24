import { useTranslation } from 'react-i18next'
import { useEffect, useId, useRef, useState } from 'react'
import { FilmStripIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function MoviePicker({
  file,
  onChange,
  hint,
  disabled = false,
}: {
  file: File | null
  onChange: (file: File | null) => void
  hint: string
  disabled?: boolean
}) {
  const { t } = useTranslation()

  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null)
  const [unplayable, setUnplayable] = useState<File | null>(null)
  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setPreview({ file, url })
    return () => URL.revokeObjectURL(url)
  }, [file])
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <Label htmlFor={id}>{t('messages.chooseBackgroundMovie')}</Label>
      <p id={`${id}-help`} className="text-sm leading-6 text-muted-foreground">
        {file ? t('messages.movieWillBeTranscoded') : hint}
      </p>
      <div className="flex min-h-36 flex-1 items-center justify-center overflow-hidden rounded-[14px] bg-muted p-4">
        {file && preview?.file === file && unplayable !== file ? (
          <video
            src={preview.url}
            aria-label={t('messages.selectedMoviePreview')}
            className="max-h-52 max-w-full rounded-xl"
            controls
            muted
            playsInline
            preload="metadata"
            onError={() => setUnplayable(file)}
          />
        ) : (
          <FilmStripIcon size={36} className="text-muted-foreground" aria-hidden="true" />
        )}
      </div>
      <Input
        ref={input}
        id={id}
        type="file"
        accept=".mp4,.webm,.mov"
        disabled={disabled}
        aria-describedby={`${id}-help`}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      {file && (
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={file.name}>
            {file.name}
          </span>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              onChange(null)
              if (input.current) input.current.value = ''
            }}
          >
            {t('messages.removeMovie')}
          </Button>
        </div>
      )}
    </div>
  )
}
