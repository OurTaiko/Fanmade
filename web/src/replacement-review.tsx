import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRightIcon } from '@phosphor-icons/react'
import { Button } from '@sitekit/components/ui/button'
import { Checkbox } from '@sitekit/components/ui/checkbox'
import { DialogClose } from '@sitekit/components/ui/dialog'
import { CategoryLabels } from '@sitekit/categories'
import { blockName } from '@sitekit/courses'
import { Modal } from '@sitekit/notifications'
import type { Line, LineLabel, Review } from '@sitekit/replacement-diff'

/** The files a replacement sends, as the review lists them. */
export type ReplacementFiles = {
  tja: string
  /** The selected audio, or null when the stored audio stays. */
  audio: { name: string; changed: boolean } | null
  keptAudio: string
  cover: string | null
  movie: { name: string } | 'remove' | null
}

function useLabel() {
  const { t } = useTranslation()
  const languages: Record<string, string> = {
    en: t('messages.english'),
    ja: t('messages.japanese'),
    zh: t('messages.chinese'),
    zh_tw: t('review.traditionalChinese'),
    ko: t('messages.korean'),
  }
  return (label: LineLabel) => {
    switch (label.field) {
      case 'title':
      case 'subtitle':
        if (!label.locale)
          return t(label.field === 'title' ? 'messages.title' : 'messages.subtitle')
        return t(
          label.field === 'title' ? 'messages.localizedTitle' : 'messages.localizedSubtitle',
          {
            language: languages[label.locale] ?? label.locale,
          },
        )
      case 'maker':
        return t('messages.courseCreator', {
          difficulty: blockName(label.slot),
        })
      case 'demo':
        return t('messages.previewRange')
      case 'description':
        return t('messages.metadataTab_description')
      case 'categories':
        return t('messages.metadataTab_categories')
      case 'bpm':
        return 'BPM'
      case 'offset':
        return 'OFFSET'
      case 'movieOffset':
        return 'MOVIEOFFSET'
    }
  }
}

function Value({ line, value }: { line: Line; value: string }) {
  const { t } = useTranslation()
  if (line.label.field === 'categories') {
    const ids = value ? value.split(',') : []
    return ids.length ? <CategoryLabels ids={ids} /> : <span>{t('review.empty')}</span>
  }
  return (
    <span className="line-clamp-3 whitespace-pre-wrap wrap-anywhere">
      {value || t('review.empty')}
    </span>
  )
}

function Change({ line }: { line: Line }) {
  const label = useLabel()
  return (
    <div className="min-w-0 space-y-1">
      <p className="font-bold">{label(line.label)}</p>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2">
        <span className="min-w-0 text-muted-foreground">
          <Value line={line} value={line.from} />
        </span>
        <ArrowRightIcon size={14} className="mt-1" aria-hidden="true" />
        <span className="min-w-0">
          <Value line={line} value={line.to} />
        </span>
      </div>
    </div>
  )
}

/**
 * Shows everything a replacement changes before it is sent: the files, the
 * site fields it would overwrite (each can be kept as it is), the values only
 * the file sets, and every block with what happens to its scores. review is
 * null while the new file is being read.
 */
export function ReplacementReview({
  review,
  files,
  busy = false,
  onCancel,
  onConfirm,
}: {
  review: Review | null
  files: ReplacementFiles
  busy?: boolean
  onCancel: () => void
  onConfirm: (kept: Set<string>) => void
}) {
  const { t } = useTranslation()
  const [kept, setKept] = useState<Set<string> | null>(null)
  const keep =
    kept ?? new Set(review?.keepable.filter((change) => change.keep).map((change) => change.key))
  const section = 'space-y-3 [&>h3]:font-extrabold'
  return (
    <Modal
      title={t('review.title')}
      alert
      busy={busy}
      className="sm:max-w-xl"
      onDismiss={onCancel}
      actions={
        <>
          <DialogClose
            render={<Button type="button" variant="outline" size="default" />}
            disabled={busy}
          >
            {t('messages.cancel')}
          </DialogClose>
          <Button
            type="button"
            variant="default"
            size="default"
            disabled={!review || busy}
            onClick={() => onConfirm(keep)}
          >
            {t('review.confirm')}
          </Button>
        </>
      }
    >
      {!review ? (
        <p role="status">{t('review.loading')}</p>
      ) : (
        <div className="space-y-6">
          <section className={section}>
            <h3>{t('review.files')}</h3>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 [&>dt]:text-muted-foreground [&>dd]:wrap-anywhere">
              <dt>TJA</dt>
              <dd>{files.tja}</dd>
              <dt>{t('review.audio')}</dt>
              <dd>
                {!files.audio
                  ? t('review.keepFile', { name: files.keptAudio })
                  : files.audio.changed
                    ? t('review.newFile', { name: files.audio.name })
                    : t('review.sameAudio', { name: files.audio.name })}
              </dd>
              {files.cover && (
                <>
                  <dt>{t('review.cover')}</dt>
                  <dd>{t('review.newFile', { name: files.cover })}</dd>
                </>
              )}
              {files.movie && (
                <>
                  <dt>{t('review.movie')}</dt>
                  <dd>
                    {files.movie === 'remove'
                      ? t('review.removeMovie')
                      : t('review.newFile', { name: files.movie.name })}
                  </dd>
                </>
              )}
            </dl>
          </section>
          {review.keepable.length > 0 && (
            <section className={section}>
              <h3>{t('review.info')}</h3>
              <p className="text-muted-foreground">{t('review.keepHint')}</p>
              <ul className="space-y-3">
                {review.keepable.map((change) => (
                  <li
                    key={change.key}
                    className="space-y-3 rounded-[10px] border-[1.5px] border-border p-3"
                  >
                    <label className="flex items-center gap-2 font-bold">
                      <Checkbox
                        checked={keep.has(change.key)}
                        disabled={busy}
                        onCheckedChange={(checked) => {
                          const next = new Set(keep)
                          if (checked) next.add(change.key)
                          else next.delete(change.key)
                          setKept(next)
                        }}
                      />
                      {t('review.keep')}
                    </label>
                    <div className={keep.has(change.key) ? 'space-y-3 opacity-50' : 'space-y-3'}>
                      {change.lines.map((line, i) => (
                        <Change key={i} line={line} />
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {review.facts.length > 0 && (
            <section className={section}>
              <h3>{t('review.chart')}</h3>
              {review.facts.map((line, i) => (
                <Change key={i} line={line} />
              ))}
            </section>
          )}
          <section className={section}>
            <h3>{t('review.blocks')}</h3>
            {files.audio?.changed && <p className="font-bold">{t('review.audioChanged')}</p>}
            <ul className="divide-y divide-border">
              {review.blocks.map((block) => (
                <li
                  key={block.slot}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
                >
                  <span className="font-bold">
                    {blockName(block.slot)}{' '}
                    <span className="font-normal text-muted-foreground tabular-nums">
                      {block.from != null && block.to != null && block.from !== block.to
                        ? `★${block.from} → ★${block.to}`
                        : `★${block.to ?? block.from ?? ''}`}
                    </span>
                  </span>
                  <span
                    className={
                      block.effect === 'retire' || block.effect === 'delete'
                        ? 'text-right text-destructive'
                        : 'text-right text-muted-foreground'
                    }
                  >
                    {t(`review.change_${block.change}`)}
                    {block.scores > 0 && (block.effect === 'retire' || block.effect === 'delete')
                      ? ` · ${t(`review.${block.effect}`, { count: block.scores })}`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Modal>
  )
}
