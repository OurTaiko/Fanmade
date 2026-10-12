import { chartText } from '@/chart-language'
import { i18n } from '@/i18n'
import { useTranslation } from 'react-i18next'
import { endpoints } from '@/api/endpoints'
import { useState } from 'react'
import { ImageIcon } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
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
        'flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl bg-[#f5f5f7] dark:bg-muted',
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
        <div className="flex flex-col items-center gap-2 p-2 text-center text-xs text-muted-foreground sm:text-sm">
          <ImageIcon className="size-6 sm:size-8" aria-hidden="true" />
          <span>{source ? t('messages.coverTemporarilyUnavailable') : t('messages.noCover')}</span>
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
      note={t('messages.savingReplacesTheCoverChartsAudioAndScoresStayIntact')}
      onSaved={onSaved}
      onDismiss={onDismiss}
    />
  )
}
