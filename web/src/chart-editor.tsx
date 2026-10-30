import { chartText } from '@sitekit/chart-language'
import { i18n } from '@sitekit/i18n'
import { useTranslation } from 'react-i18next'
import { endpoints } from '@sitekit/api/endpoints'
import { Button } from '@sitekit/components/ui/button'
import { Card } from '@sitekit/components/ui/card'
import { Progress } from '@sitekit/components/ui/progress'
import { ChoiceSelect } from '@sitekit/components/choice-select'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowCounterClockwiseIcon,
  CaretLeftIcon,
  FloppyDiskIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { api, previewReplacement, uploadChart } from '@sitekit/api/client'
import type { Chart } from './api/types'
import { baseCourse, blockName, slotKey } from '@sitekit/courses'
import { isChartOwner } from '@sitekit/chart-owners'
import { useSession } from '@sitekit/session-context'
import { Notice } from '@sitekit/notifications'
import { useNotification } from '@sitekit/notification-context'
import { parsePreviewTja } from '@sitekit/preview-tja'
import { maxTja, parseTja, ValidationError } from './tja'
import type { Side } from './tja'
import { withChartTitles } from '@sitekit/tja-titles'
import { replacementFields, reviewReplacement } from '@sitekit/replacement-diff'
import type { Proposal, ReplacementPreview, Review } from '@sitekit/replacement-diff'
import { ReplacementReview } from '@sitekit/replacement-review'

const ChartPreview = lazy(() => import('@sitekit/chart-preview'))
const TjaEditor = lazy(() => import('@sitekit/components/tja-editor'))

function createRequestKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// The line a TJA validation error points at, when the API gave one.
function errorLine(e: unknown): number | undefined {
  if (e instanceof ValidationError) return e.line > 0 ? e.line : undefined
  const cause = (e as { cause?: { line?: unknown; errors?: { line?: unknown }[] } }).cause
  const line = cause?.line ?? cause?.errors?.[0]?.line
  return typeof line === 'number' && line > 0 ? line : undefined
}

/**
 * Edits a chart's TJA in the browser with a live rendering. Saving sends the
 * text as the new TJA through the same replacement as the update page, with
 * the audio and movie kept, after the same review of what it changes: blocks
 * the new text no longer has go with their scores, and older scores leave the
 * leaderboard.
 */
export function ChartEditorPage() {
  const { t } = useTranslation()
  const { notify } = useNotification()
  const { id } = useParams()
  const session = useSession()
  const [chart, setChart] = useState<Chart | null>(null)
  const [error, setError] = useState('')
  const [original, setOriginal] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [preview, setPreview] = useState('')
  const [course, setCourse] = useState('')
  // Open while the server reads the text (review null) and until the update is confirmed.
  const [reviewing, setReviewing] = useState<{
    file: File
    /** The text drops the movie the chart has. */
    dropsMovie: boolean
    preview: ReplacementPreview | null
    review: Review | null
  } | null>(null)
  const attempted = useRef('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [saveError, setSaveError] = useState('')
  const [jump, setJump] = useState<{ line: number; at: number } | null>(null)
  const requestKey = useRef(createRequestKey())
  const controller = useRef<AbortController | null>(null)
  const dirty = original !== null && text !== original

  useEffect(() => {
    const aborter = new AbortController()
    setChart(null)
    setError('')
    setOriginal(null)
    setText('')
    setPreview('')
    if (!id) return
    async function load() {
      try {
        const loaded = await api<Chart>(endpoints.chartDetail(id!), { signal: aborter.signal })
        const response = await fetch(endpoints.resource(loaded, 'tja'), {
          signal: aborter.signal,
          credentials: 'omit',
        })
        if (!response.ok)
          throw new Error(i18n.t('messages.chartHttpError', { status: response.status }))
        const bytes = await response.arrayBuffer()
        if (bytes.byteLength > maxTja)
          throw new Error(i18n.t('messages.chartExceedsThePreviewSizeLimit'))
        // The editor keeps lines apart by "\n", so other line breaks are
        // normalized before anything compares. The title headers are the
        // chart's own names, so saving keeps them.
        const source = withChartTitles(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n?/g, '\n'),
          loaded,
        )
        if (aborter.signal.aborted) return
        setChart(loaded)
        setOriginal(source)
        setText(source)
        setPreview(source)
      } catch (e) {
        if (!aborter.signal.aborted)
          setError(e instanceof Error ? e.message : i18n.t('messages.failedToLoadChart'))
      }
    }
    void load()
    return () => aborter.abort()
  }, [id])

  // The rendering follows the text after a short pause in typing.
  useEffect(() => {
    if (text === preview) return
    const timer = setTimeout(() => setPreview(text), 300)
    return () => clearTimeout(timer)
  }, [text, preview])

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  useEffect(() => () => controller.current?.abort(), [])

  const blocks = useMemo(() => {
    if (!preview) return { keys: [] as string[], error: '' }
    try {
      return { keys: Object.keys(parsePreviewTja(preview)), error: '' }
    } catch (e) {
      return { keys: [], error: e instanceof Error ? e.message : t('messages.failedToParseTja') }
    }
  }, [preview, t])
  // Keep the chosen block while it exists; otherwise show the first one.
  const shownCourse = blocks.keys.includes(course) ? course : (blocks.keys[0] ?? '')
  const previewChart = useMemo(
    () =>
      chart && {
        ...chart,
        difficulties: blocks.keys.map(
          (key) =>
            chart.difficulties.find((d) => slotKey(d) === key) ?? {
              course: baseCourse(key),
              side: (key.endsWith('_1p') ? 'p1' : key.endsWith('_2p') ? 'p2' : 'single') as Side,
              level: 0,
              maker: '',
            },
        ),
      },
    [chart, blocks.keys],
  )

  // The site fields go back as the chart has them unless the review lets the new text change them.
  const proposal = (current: Chart): Proposal => ({
    description: current.description,
    categoryIds: current.categoryIds,
    demoStart: current.demoStart,
    demoEnd: current.demoEnd ?? current.demoStart + 15,
    typedMakers: {},
    typedDemo: false,
  })
  const fail = (e: unknown) => {
    setSaveError(e instanceof Error ? e.message : t('messages.requestFailed'))
    const line = errorLine(e)
    if (line) setJump({ line, at: Date.now() })
  }
  const startReview = async () => {
    if (!chart || !dirty || busy) return
    setSaveError('')
    const abort = new AbortController()
    controller.current = abort
    try {
      const bytes = new TextEncoder().encode(text)
      // The same validation the upload runs, against the stored audio's name.
      const parsed = parseTja(bytes, chart.wave)
      const file = new File([bytes], chart.tjaName, { type: 'text/plain;charset=utf-8' })
      const dropsMovie = !parsed.movie && !!chart.movieHash
      setReviewing({ file, dropsMovie, preview: null, review: null })
      const preview = await previewReplacement(
        chart.id,
        file,
        undefined,
        session.csrfToken,
        abort.signal,
      )
      if (abort.signal.aborted) return
      setReviewing({
        file,
        dropsMovie,
        preview,
        review: reviewReplacement(chart, preview, proposal(chart), false, {
          demo: true,
          makers: true,
        }),
      })
    } catch (e) {
      setReviewing(null)
      if (!abort.signal.aborted) fail(e)
    }
  }
  const save = async (kept: Set<string>) => {
    if (!chart || !reviewing?.preview || busy) return
    const { file, preview } = reviewing
    setReviewing(null)
    setBusy(true)
    setProgress(0)
    controller.current = new AbortController()
    try {
      const fields = replacementFields(chart, preview, proposal(chart), kept)
      // Other text or choices are a different request; the same ones retry the last.
      const attempt = [...kept].sort().join(',') + '\n' + text
      if (attempt !== attempted.current) requestKey.current = createRequestKey()
      attempted.current = attempt
      const form = new FormData()
      form.append('tja', file)
      form.append('confirmReset', 'true')
      if (fields.keepTitles) form.append('keepTitles', 'true')
      form.append('description', fields.description)
      form.append('demoStart', String(fields.demoStart))
      form.append('demoEnd', String(fields.demoEnd))
      form.append('categoryIds', JSON.stringify(fields.categoryIds))
      form.append('difficultyMakers', JSON.stringify(fields.difficultyMakers))
      const updated = await uploadChart<Chart>(
        form,
        session.csrfToken,
        requestKey.current,
        controller.current.signal,
        setProgress,
        chart.id,
        true,
      )
      if ('status' in updated) throw new Error(t('messages.requestFailed'))
      requestKey.current = createRequestKey()
      attempted.current = ''
      setChart(updated)
      setOriginal(text)
      notify(t('editor.saved'), 'success')
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  if (!id) return <Notice>{t('messages.missingSongId')}</Notice>
  if (session.loading) return <p role="status">{t('messages.loadingAccount')}</p>
  if (error) return <Notice>{error}</Notice>
  if (!chart || original === null)
    return <p className="text-sm text-muted-foreground">{t('editor.loading')}</p>
  const canManage = isChartOwner(chart, session.user?.id) || !!session.user?.isAdmin
  if (!canManage) return <Notice>{t('editor.onlyManagers')}</Notice>
  const title = chartText(chart, i18n.resolvedLanguage).title
  const lines = text.length ? text.split('\n').length : 0
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 [&_p]:mt-2 [&_p]:text-sm [&_p]:text-muted-foreground">
          <Link
            to={`/charts/${chart.id}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <CaretLeftIcon size={14} aria-hidden="true" />
            {title}
          </Link>
          <h1 className="text-2xl font-extrabold sm:text-3xl">{t('editor.title')}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground tabular-nums" role="status">
            {dirty ? t('messages.unsavedChanges') : t('editor.lines', { count: lines })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="default"
            disabled={!dirty || busy}
            onClick={() => setText(original)}
          >
            <ArrowCounterClockwiseIcon size={16} />
            {t('editor.discard')}
          </Button>
          <Button
            type="button"
            variant="default"
            size="default"
            disabled={!dirty || busy || !!blocks.error}
            onClick={() => void startReview()}
          >
            <FloppyDiskIcon size={16} />
            {busy ? t('messages.saving') : t('editor.save')}
          </Button>
        </div>
      </div>
      {busy && <Progress value={progress} aria-label={t('messages.saving')} />}
      {saveError && (
        <Notice>
          <span className="inline-flex items-center gap-2">
            <WarningCircleIcon size={16} className="shrink-0" aria-hidden="true" />
            {saveError}
          </span>
        </Notice>
      )}
      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
        <Card className="min-w-0 gap-3 overflow-hidden border-[1.5px] border-border p-0 shadow-none">
          <h2 className="px-5 pt-5 text-base font-extrabold sm:px-6">{t('editor.editorLabel')}</h2>
          <Suspense
            fallback={
              <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">
                {t('editor.loadingEditor')}
              </p>
            }
          >
            <TjaEditor
              value={text}
              onChange={setText}
              disabled={busy}
              jumpToLine={jump}
              onSave={() => {
                if (dirty && !busy && !blocks.error && !reviewing) void startReview()
              }}
              ariaLabel={t('editor.editorLabel')}
              className="h-[70svh] min-h-80 border-t text-sm"
            />
          </Suspense>
        </Card>
        <Card className="min-w-0 gap-4 border-[1.5px] border-border p-5 shadow-none sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-extrabold">{t('editor.previewHeading')}</h2>
            {blocks.keys.length > 0 && (
              <ChoiceSelect
                label={t('editor.block')}
                value={shownCourse}
                onValueChange={setCourse}
                items={blocks.keys.map((key) => ({
                  value: key,
                  label: blockName(key),
                }))}
              />
            )}
          </div>
          {blocks.error ? (
            <Notice>{blocks.error}</Notice>
          ) : !previewChart || !shownCourse ? (
            <p className="text-sm text-muted-foreground">{t('editor.noBlocks')}</p>
          ) : (
            <Suspense
              fallback={
                <p role="status" className="text-sm text-muted-foreground">
                  {t('messages.loadingChartPreview')}
                </p>
              }
            >
              <ChartPreview
                key={shownCourse}
                chart={previewChart}
                source={preview}
                course={shownCourse}
              />
            </Suspense>
          )}
        </Card>
      </div>
      {reviewing && (
        <ReplacementReview
          review={reviewing.review}
          files={{
            tja: chart.tjaName,
            audio: null,
            keptAudio: chart.audioName,
            cover: null,
            movie: reviewing.dropsMovie ? 'remove' : null,
          }}
          onCancel={() => {
            controller.current?.abort()
            setReviewing(null)
          }}
          onConfirm={(kept) => void save(kept)}
        />
      )}
    </div>
  )
}
