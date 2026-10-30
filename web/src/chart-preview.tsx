import { chartText } from '@sitekit/chart-language'
import { slotKey } from './courses'
import { i18n } from '@sitekit/i18n'
import { t } from '@sitekit/i18n'
import { useTranslation } from 'react-i18next'
import { ChoiceSelect } from '@sitekit/components/choice-select'
import { Label } from '@sitekit/components/ui/label'
import { Button } from '@sitekit/components/ui/button'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  GitBranchIcon as GitBranch,
  CursorClickIcon as MousePointerClick,
  ArrowCounterClockwiseIcon as RotateCcw,
  MagnifyingGlassPlusIcon as ZoomIn,
  MagnifyingGlassMinusIcon as ZoomOut,
} from '@phosphor-icons/react'
import { PALETTE } from '../TJARenderer/src/renderer'
import { createChartView, DEFAULT_RENDER_OPTIONS } from '../TJARenderer/src/internal'
import type { RenderOptions } from '../TJARenderer/src/internal'
import type { HitInfo } from '../TJARenderer/src/hit-testing'
import type { BranchName, NoteLocation } from '../TJARenderer/src/primitives'
import type { Chart } from './api/types'
import { Notice } from '@sitekit/notifications'
import { useNotification } from '@sitekit/notification-context'
import { parsePreviewTja } from './preview-tja'

const getBranchLabels = () => ({
  normal: t('messages.normalBranch'),
  expert: t('messages.expertBranch'),
  master: t('messages.masterBranch'),
})
const zoomLevels = [4, 8, 12, 16, 24, 32, 48]
const initialZoom = () => (window.matchMedia('(max-width: 600px)').matches ? 4 : 16)
function sameNote(a: NoteLocation, b: NoteLocation) {
  return a.barIndex === b.barIndex && a.charIndex === b.charIndex && a.branch === b.branch
}
function number(value: number | undefined) {
  return value === undefined || !Number.isFinite(value) ? '—' : Number(value.toFixed(2)).toString()
}

export default function ChartPreview({
  chart,
  source,
  course,
}: {
  chart: Chart
  source: string
  course: string
}) {
  const { t } = useTranslation()

  const branchLabels = getBranchLabels()
  const { title, subtitle } = chartText(chart, i18n.resolvedLanguage)
  const { notify } = useNotification()
  const [branch, setBranch] = useState<'all' | BranchName>('all')
  const [zoom, setZoom] = useState(initialZoom)
  const [selected, setSelected] = useState<HitInfo | null>(null)
  const [hovered, setHovered] = useState<HitInfo | null>(null)
  const [renderError, setRenderError] = useState('')
  const [reset, setReset] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const parsed = useMemo(() => {
    try {
      return { blocks: parsePreviewTja(source), error: '' }
    } catch (e) {
      return {
        blocks: null,
        error: e instanceof Error ? e.message : t('messages.failedToParseTja'),
      }
    }
  }, [source, t])
  const root = parsed.blocks?.[course]
  const selectedChart = branch === 'all' ? root : (root?.branches?.[branch] ?? root)
  const currentChart = useMemo(
    () =>
      selectedChart
        ? {
            ...selectedChart,
            title,
            subtitle,
            course,
            level:
              chart.difficulties.find((d) => slotKey(d) === course)?.level ?? selectedChart.level,
          }
        : null,
    [selectedChart, title, subtitle, chart.difficulties, course],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    const viewport = viewportRef.current
    if (!canvas || !viewport || !currentChart) return
    setSelected(null)
    setHovered(null)
    setRenderError('')
    const options: RenderOptions = {
      ...DEFAULT_RENDER_OPTIONS,
      beatsPerLine: zoom,
      showAllBranches: branch === 'all' && Boolean(root?.branches),
      showAttribution: true,
      tjaSourceName: 'OurTaiko Fanmade',
      selection: null,
      hoveredNote: null,
    }
    const view = createChartView(currentChart, canvas)
    const previousPalette = structuredClone(PALETTE)
    const applyPalette = () => {
      const tokens = getComputedStyle(document.documentElement)
      const color = (name: string) => tokens.getPropertyValue(`--${name}`).trim()
      PALETTE.background = color('background')
      PALETTE.text.primary = color('foreground')
      PALETTE.text.secondary = color('muted-foreground')
      PALETTE.text.label = color('foreground')
      PALETTE.ui.barBorder = color('foreground')
      PALETTE.ui.barVerticalLine = color('background')
      PALETTE.ui.centerLine = color('border')
      PALETTE.ui.gridLine = color('border')
      PALETTE.ui.selectionBorder = color('primary')
      PALETTE.ui.warning.background = color('muted')
      PALETTE.ui.warning.text = color('destructive')
      PALETTE.ui.streamWaiting.background = color('muted')
      PALETTE.ui.streamWaiting.text = color('muted-foreground')
      PALETTE.status.bpm = color('foreground')
      PALETTE.status.hs = color('foreground')
      PALETTE.status.line = color('muted-foreground')
      for (const course of Object.keys(PALETTE.courses) as (keyof typeof PALETTE.courses)[]) {
        PALETTE.courses[course] = color('primary')
      }
      // Note and branch colors carry musical meaning and keep the renderer's palette.
    }
    const render = () => {
      try {
        applyPalette()
        view.invalidateLayout()
        view.render({ renderOptions: options, dpr: window.devicePixelRatio || 1 })
      } catch (e) {
        setRenderError(e instanceof Error ? e.message : t('messages.failedToRenderChart'))
      }
    }
    render()
    const themeObserver = new MutationObserver(render)
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
    const removeHover = view.onNoteHovered(({ hit }) => {
      canvas.classList.toggle('cursor-pointer', Boolean(hit))
      setHovered((previous) =>
        previous && hit && sameNote(previous.location, hit.location) ? previous : hit,
      )
    })
    const removeClick = view.onNoteClicked(({ hit }) => {
      setSelected(hit)
      if (!hit) options.selection = null
      else if (hit.location.charIndex >= 0) {
        const selection = options.selection
        if (!selection || selection.end) options.selection = { start: hit.location, end: null }
        else if (sameNote(selection.start, hit.location)) {
          options.selection = null
          setSelected(null)
        } else options.selection = { start: selection.start, end: hit.location }
      }
      render()
    })
    let frame = 0
    let width = viewport.clientWidth
    const observer = new ResizeObserver(() => {
      const next = viewport.clientWidth
      if (next === width) return
      width = next
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(render)
    })
    observer.observe(viewport)
    return () => {
      removeHover()
      removeClick()
      themeObserver.disconnect()
      Object.assign(PALETTE, previousPalette)
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [currentChart, zoom, branch, root, reset, t])

  const info = selected ?? hovered
  if (parsed.error || !root)
    return (
      <div className="flex min-h-40 flex-col items-center justify-center gap-3 py-6 text-center">
        <Notice>{parsed.error || t('messages.noPreviewableChartBlocksForThisDifficulty')}</Notice>
      </div>
    )
  const zoomIndex = zoomLevels.indexOf(zoom)
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3 [&>label]:flex [&>label]:flex-wrap [&>label]:items-center [&>label]:gap-2">
          {root.branches && (
            <Label>
              <GitBranch size={16} />
              {t('messages.branch')}
              <ChoiceSelect
                label={t('messages.selectBranch')}
                value={branch}
                onValueChange={(value) => setBranch(value as typeof branch)}
                items={[
                  { value: 'all', label: t('messages.allBranches') },
                  ...Object.entries(branchLabels)
                    .filter(([key]) => root.branches?.[key as BranchName])
                    .map(([value, label]) => ({ value, label })),
                ]}
              />
            </Label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="default"
              aria-label={t('messages.zoomIn')}
              disabled={zoomIndex === 0}
              onClick={() => setZoom(zoomLevels[zoomIndex - 1])}
            >
              <ZoomIn size={17} />
            </Button>
            <Label>
              <span className="sr-only">{t('messages.beatsPerRow')}</span>
              <ChoiceSelect
                label={t('messages.beatsPerRow')}
                value={String(zoom)}
                onValueChange={(value) => setZoom(Number(value))}
                items={zoomLevels.map((n) => ({
                  value: String(n),
                  label: t('messages.beatsPerRowOption', { beats: n }),
                }))}
              />
            </Label>
            <Button
              type="button"
              variant="outline"
              size="default"
              aria-label={t('messages.zoomOut')}
              disabled={zoomIndex === zoomLevels.length - 1}
              onClick={() => setZoom(zoomLevels[zoomIndex + 1])}
            >
              <ZoomOut size={17} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="default"
              onClick={() => {
                setZoom(initialZoom())
                setBranch('all')
                setReset((n) => n + 1)
              }}
            >
              <RotateCcw size={16} />
              {t('messages.reset')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="default"
              onClick={() =>
                notify(
                  t('messages.clickANoteForDetailsClickTwoNotesToSelectARange'),
                  'info',
                  t('messages.previewInstructions'),
                )
              }
            >
              <MousePointerClick size={16} />
              {t('messages.instructions')}
            </Button>
          </div>
        </div>
        <div
          className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-x-5 gap-y-2 text-right text-sm tabular-nums [&>div]:flex [&>div]:flex-col [&>div]:gap-1 [&_span]:text-xs [&_span]:text-muted-foreground"
          role="status"
          data-testid="preview-note-info"
          aria-live="polite"
        >
          <div>
            <span>{t('messages.measureNote')}</span>
            <strong>
              {info
                ? `${info.location.barIndex + 1} / ${info.ordinal ?? '—'}`
                : t('messages.clickANote')}
            </strong>
          </div>
          <div>
            <span>BPM</span>
            <strong>{number(info?.bpm)}</strong>
          </div>
          <div>
            <span>{t('messages.scrollSpeed')}</span>
            <strong>{number(info?.scroll)}</strong>
          </div>
          <div>
            <span>{t('messages.bpmSpeed')}</span>
            <strong>
              {number(
                info?.bpm !== undefined && info.scroll !== undefined
                  ? info.bpm * info.scroll
                  : undefined,
              )}
            </strong>
          </div>
          {root.branches && (
            <div>
              <span>{t('messages.branch')}</span>
              <strong>{info?.location.branch ? branchLabels[info.location.branch] : '—'}</strong>
            </div>
          )}
        </div>
      </div>
      {renderError && <Notice>{renderError}</Notice>}
      <div
        ref={viewportRef}
        className="max-h-[75svh] max-w-full overflow-auto overscroll-contain rounded-xl border bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring"
        tabIndex={0}
        role="region"
        aria-label={t('messages.scrollableChartPreview')}
      >
        <canvas
          className="block w-full"
          ref={canvasRef}
          aria-label={t('messages.interactiveChartPreview', { difficulty: course })}
        >
          {t('messages.interactiveChartPreviewDownloadTheOriginalTjaForTheFullChart')}
        </canvas>
      </div>
    </div>
  )
}
