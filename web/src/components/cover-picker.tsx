import { useTranslation } from 'react-i18next'
import { useEffect, useId, useRef, useState } from 'react'
import { ImageIcon } from '@phosphor-icons/react'
import { Button } from '@sitekit/components/ui/button'
import { Input } from '@sitekit/components/ui/input'
import { Label } from '@sitekit/components/ui/label'
import { coverFileError } from '@sitekit/cover'

export function CoverPicker({
  file,
  onChange,
  disabled = false,
}: {
  file: File | null
  onChange: (file: File | null) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()

  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setPreview({ file, url })
    return () => URL.revokeObjectURL(url)
  }, [file])
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <Label htmlFor={id}>{t('messages.chooseJpgPngOrWebpCover')}</Label>
      <p id={`${id}-help`} className="text-sm leading-6 text-muted-foreground">
        {t('messages.upTo8MibAnd16MegapixelsImagesAreScaledProportionally')}
      </p>
      <div className="flex min-h-36 flex-1 items-center justify-center overflow-hidden rounded-[14px] bg-muted p-4">
        {file && preview?.file === file ? (
          <img
            src={preview.url}
            alt={t('messages.selectedCoverPreview')}
            className="max-h-52 max-w-full rounded-xl object-contain"
            onError={() => {
              setError(t('messages.cannotReadCoverChooseAValidJpgPngOrWebpImage'))
              onChange(null)
              if (input.current) input.current.value = ''
            }}
            onLoad={(event) => {
              const image = event.currentTarget
              if (
                image.naturalWidth * image.naturalHeight > 16_000_000 ||
                image.naturalWidth > 8192 ||
                image.naturalHeight > 8192
              ) {
                setError(t('messages.coverMustNotExceed16MegapixelsOr8192PixelsOnEitherSide'))
                onChange(null)
                if (input.current) input.current.value = ''
              }
            }}
          />
        ) : (
          <ImageIcon size={36} className="text-muted-foreground" aria-hidden="true" />
        )}
      </div>
      <Input
        ref={input}
        id={id}
        type="file"
        accept=".jpg,.jpeg,.png,.webp"
        disabled={disabled}
        aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`}
        aria-invalid={!!error}
        onChange={(event) => {
          const chosen = event.target.files?.[0]
          if (!chosen) return
          const message = coverFileError(chosen)
          setError(message)
          if (message) {
            onChange(null)
            event.target.value = ''
            return
          }
          onChange(chosen)
        }}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
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
              setError('')
              if (input.current) input.current.value = ''
            }}
          >
            {t('messages.clearSelection')}
          </Button>
        </div>
      )}
    </div>
  )
}
