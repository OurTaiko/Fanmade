import { chartText } from '@/chart-language'
import { i18n } from '@/i18n'
import { useTranslation } from 'react-i18next'
import { endpoints } from '@/api/endpoints'
import { useState } from 'react'
import { cn } from '@sitekit/lib/utils'
import { CoverUploadDialog } from './cover-dialog'
import type { Chart } from '../api/types'
import { coverSource } from '../cover'

export function ChartCover({ chart, className }: { chart: Chart; className?: string }) {
  const { t } = useTranslation()

  const [failedSource, setFailedSource] = useState('')
  const source = coverSource(chart)
  const available = source && failedSource !== source
  return (
    <div
      className={cn(
        'flex aspect-[4/3] items-center justify-center overflow-hidden rounded-[14px] bg-muted',
        className,
      )}
    >
      {available ? (
        <img
          src={source}
          alt={t('messages.songCoverAlt', {
            title: chartText(chart, i18n.resolvedLanguage).title,
          })}
          className="size-full object-contain"
          onError={() => setFailedSource(source)}
        />
      ) : (
        <div className="flex justify-center items-center bg-cream size-full">
          <span
            aria-hidden="true"
            className="bg-(--hero) border-[2.5px] border-outline rounded-full w-2/5 max-w-28 aspect-square shadow-[inset_0_0_0_10px_rgb(255_255_255/0.5)]"
          />
          <span className="sr-only">
            {source ? t('messages.coverTemporarilyUnavailable') : t('messages.noCover')}
          </span>
        </div>
      )}
    </div>
  )
}

// Owners and administrators replace covers from the chart page's management actions.
export function CoverDialog({
  chart,
  onSaved,
  onDismiss,
}: {
  chart: Chart
  onSaved: (coverHash: string) => void
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  return (
    <CoverUploadDialog
      title={t('messages.changeSongCover')}
      endpoint={endpoints.cover(chart.id)}
      onSaved={onSaved}
      onDismiss={onDismiss}
    />
  )
}
