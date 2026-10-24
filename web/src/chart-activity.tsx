import { Link } from 'react-router-dom'
import { formatLocale, i18n } from '@/i18n'
import { useTranslation } from 'react-i18next'
import { endpoints } from '@/api/endpoints'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/user-avatar'
import { ProfilePlate } from '@/components/profile-plate'
import {
  Table,
  TableCaption,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
  FileAudioIcon as FileMusic,
  TrophyIcon as Trophy,
  StarIcon,
  ArrowCounterClockwiseIcon as RotateCcw,
} from '@phosphor-icons/react'
import { api } from './api/client'
import type { Chart, Leaderboard } from './api/types'
import {
  courseNames,
  isSupportedCourse,
  baseCourse,
  groupCourses,
  sideName,
  slotKey,
  groupLevel,
  groupName,
} from './courses'
import { Notice } from './notifications'
import { withChartTitles } from './tja-titles'
import { defaultDifficulty } from './chart-difficulty'
import { useSession } from './session-context'
import { maxTja } from './tja'

const ChartPreview = lazy(() => import('./chart-preview'))
const EmbeddedPlayer = lazy(() => import('./embedded-player'))

const difficultyTabColors = {
  Easy: '[--difficulty-bg:#f9a15a]',
  Normal: '[--difficulty-bg:#8fd16a]',
  Hard: '[--difficulty-bg:#6cc7d8]',
  Oni: '[--difficulty-bg:#f77fab]',
  Edit: '[--difficulty-bg:#b99ae8]',
}

const tabButtonGroupClassName =
  'shrink-0 gap-0 overflow-hidden rounded-[10px] border-2 border-outline bg-card p-0'
const tabButtonClassName =
  'h-full rounded-none px-3 text-muted-foreground shadow-none not-first:border-l! not-first:border-l-border! hover:bg-muted/50 focus-visible:z-10 focus-visible:-ring-offset-2 data-active:bg-muted data-active:text-foreground dark:hover:bg-muted/50 dark:data-active:bg-muted after:hidden'
const difficultyTabClassName =
  'bg-transparent font-bold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring data-active:bg-[var(--difficulty-bg)] data-active:text-[#382d2a] data-active:hover:bg-[var(--difficulty-bg)] data-active:hover:text-[#382d2a]'

export type ActivityTab = 'image' | 'preview' | 'leaderboard'

export function ChartActivity({
  chart,
  tab,
  onTabChange,
}: {
  chart: Chart
  tab: ActivityTab
  onTabChange: (tab: ActivityTab) => void
}) {
  const { t } = useTranslation()

  const [course, setCourse] = useState(() => defaultDifficulty(chart.difficulties))
  const [source, setSource] = useState('')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  // The blocks of one course are one chart: one tab per course, then a side
  // switch for the preview and the per-block leaderboard. `course` is the
  // chosen block's slot key.
  const groups = groupCourses(chart.difficulties)
  const group = groups.find((g) => g.base === baseCourse(course))
  const { id, encoding } = chart
  // Reload the text when any block changed (the file behind it did).
  const blockHashes = chart.difficulties.map((d) => d.chartHash ?? '').join(',')
  // The image and the player name the chart as the site does, not as the
  // stored TJA's headers may.
  const titled = useMemo(() => (source ? withChartTitles(source, chart) : ''), [source, chart])

  useEffect(() => {
    const controller = new AbortController()
    setSource('')
    setError('')
    async function load() {
      try {
        const response = await fetch(endpoints.resource({ id }, 'tja'), {
          signal: controller.signal,
          credentials: 'omit',
        })
        if (!response.ok)
          throw new Error(i18n.t('messages.chartHttpError', { status: response.status }))
        if (Number(response.headers.get('Content-Length')) > maxTja)
          throw new Error(i18n.t('messages.chartExceedsThePreviewSizeLimit'))
        const bytes = await response.arrayBuffer()
        if (bytes.byteLength > maxTja)
          throw new Error(i18n.t('messages.chartExceedsThePreviewSizeLimit'))
        const text = new TextDecoder(encoding, { fatal: true }).decode(bytes)
        if (!controller.signal.aborted) setSource(text)
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : i18n.t('messages.failedToLoadChart'))
      }
    }
    void load()
    return () => controller.abort()
  }, [id, blockHashes, encoding, attempt])

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => onTabChange(value as ActivityTab)}
      className="min-w-0 gap-5 rounded-[14px] border-2 border-outline bg-card p-5 shadow-drop sm:p-6"
      aria-label={t('messages.chartPreviewAndLeaderboard')}
      data-testid="chart-activity"
    >
      <section
        className="flex min-w-0 flex-wrap items-center justify-between gap-3"
        aria-label={t('messages.chartContentAndDifficultySelection')}
      >
        <TabsList
          aria-label={t('messages.songDetails')}
          className={cn(tabButtonGroupClassName, tab === 'leaderboard' && 'max-lg:hidden')}
        >
          <TabsTrigger value="image" className={tabButtonClassName}>
            <FileMusic size={18} />
            {t('messages.chartImage')}
          </TabsTrigger>
          <TabsTrigger value="preview" className={tabButtonClassName}>
            <FileMusic size={18} />
            {t('messages.chartPreview')}
          </TabsTrigger>
          {/* Below lg the page tabs open the leaderboard. */}
          <TabsTrigger value="leaderboard" className={cn(tabButtonClassName, 'max-lg:hidden')}>
            <Trophy size={18} />
            {t('messages.leaderboard')}
          </TabsTrigger>
        </TabsList>
        <div className="-mx-1 flex min-w-0 max-w-full items-center gap-3 overflow-x-auto px-1 py-1">
          <Tabs
            value={group?.base ?? ''}
            onValueChange={(value) => {
              const next = groups.find((g) => g.base === value)
              if (!next) return
              // Keep the chosen side when the next course has it too.
              const side = course.slice(baseCourse(course).length)
              setCourse(
                next.sides.map(slotKey).find((key) => key === `${next.base}${side}`) ??
                  slotKey(next.sides[0]),
              )
            }}
            className="shrink-0"
          >
            <TabsList
              aria-label={t('messages.selectDifficulty')}
              className={tabButtonGroupClassName}
            >
              {groups.map((g) => (
                <TabsTrigger
                  key={g.base}
                  value={g.base}
                  className={`${tabButtonClassName} ${difficultyTabClassName} ${difficultyTabColors[g.base]}`}
                >
                  {groupName(g)}
                  <span
                    className="inline-flex items-center gap-1 tabular-nums"
                    aria-label={g.sides
                      .map((d) => t('common.stars', { count: d.level }))
                      .filter((label, index, all) => all.indexOf(label) === index)
                      .join(' / ')}
                  >
                    <StarIcon weight="fill" className="size-3" aria-hidden="true" />
                    {groupLevel(g)}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {group && group.sides.length > 1 && (
            <Tabs
              value={course}
              onValueChange={(value) => setCourse(String(value))}
              className="shrink-0"
            >
              <TabsList
                aria-label={t('messages.selectPlayerSide')}
                className={tabButtonGroupClassName}
              >
                {group.sides.map((d) => (
                  <TabsTrigger key={slotKey(d)} value={slotKey(d)} className={tabButtonClassName}>
                    {sideName(d.side)}
                    <span
                      className="inline-flex items-center gap-1 tabular-nums"
                      aria-label={t('common.stars', { count: d.level })}
                    >
                      <StarIcon weight="fill" className="size-3" aria-hidden="true" />
                      {d.level}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
        </div>
      </section>
      <div className="min-w-0">
        <TabsContent value="image">
          {tab === 'image' &&
            (error ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-3 py-6 text-center">
                <Notice>{error}</Notice>
                <Button variant="outline" size="default" onClick={() => setAttempt((n) => n + 1)}>
                  <RotateCcw size={16} />
                  {t('messages.reload')}
                </Button>
              </div>
            ) : !source ? (
              <p
                className="flex min-h-40 flex-col items-center justify-center gap-3 py-6 text-center text-sm text-muted-foreground"
                role="status"
              >
                {t('messages.loadingTjaFromServer')}
              </p>
            ) : (
              <Suspense
                fallback={
                  <p
                    className="flex min-h-40 flex-col items-center justify-center gap-3 py-6 text-center text-sm text-muted-foreground"
                    role="status"
                  >
                    {t('messages.loadingChartPreview')}
                  </p>
                }
              >
                <ChartPreview key={course} chart={chart} source={titled} course={course} />
              </Suspense>
            ))}
        </TabsContent>
        <TabsContent value="preview">
          {tab === 'preview' &&
            (error ? (
              <div className="space-y-3">
                <Notice>{error}</Notice>
                <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
                  {t('messages.reload')}
                </Button>
              </div>
            ) : !source ? (
              <p role="status">{t('messages.loadingTjaFromServer')}</p>
            ) : (
              <Suspense fallback={<p role="status">{t('messages.loadingChartPreview')}</p>}>
                <EmbeddedPlayer chart={chart} source={titled} course={course} />
              </Suspense>
            ))}
        </TabsContent>
        <TabsContent value="leaderboard">
          {tab === 'leaderboard' && <ChartLeaderboard key={course} chart={chart} course={course} />}
        </TabsContent>
      </div>
    </Tabs>
  )
}

function ChartLeaderboard({ chart, course }: { chart: Chart; course: string }) {
  const { t } = useTranslation()

  const [page, setPage] = useState(1)
  const [data, setData] = useState<Leaderboard | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const { user } = useSession()
  const { id } = chart
  // Every block of a song has its own leaderboard.
  const difficultyId = chart.difficulties.find((d) => slotKey(d) === course)?.id
  useEffect(() => {
    const controller = new AbortController()
    setData(null)
    setError('')
    api<Leaderboard>(endpoints.leaderboard(id, { difficultyId, page }), {
      signal: controller.signal,
    })
      .then((response) => {
        if (!controller.signal.aborted) setData(response)
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [id, difficultyId, page, attempt])
  if (error)
    return (
      <div className="flex min-h-40 flex-col items-center justify-center gap-3 py-6 text-center">
        <Notice>{error}</Notice>
        <Button variant="outline" size="default" onClick={() => setAttempt((n) => n + 1)}>
          {t('messages.retry')}
        </Button>
      </div>
    )
  if (!data)
    return (
      <p
        className="flex min-h-40 flex-col items-center justify-center gap-3 py-6 text-center text-sm text-muted-foreground"
        role="status"
      >
        {t('messages.loadingLeaderboard')}
      </p>
    )
  if (!data.supported)
    return (
      <div className="flex min-h-40 flex-col items-center justify-center gap-3 py-6 text-center">
        <Notice kind="info" title={t('messages.leaderboardUnavailable')}>
          {t('messages.serverDoesNotSupportLeaderboard')}
        </Notice>
      </div>
    )
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm [&>span]:text-muted-foreground">
        <strong>{t('common.playerCount', { count: data.total })}</strong>
        <span>{t('messages.bestScoresTiesShareRanks')}</span>
      </div>
      {data.items.length === 0 ? (
        <div className="flex min-h-40 flex-col items-center justify-center gap-3 py-6 text-center">
          <h3 className="text-base font-extrabold">
            {data.total ? t('messages.noScoresOnThisPage') : t('messages.noScoresYet')}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t('messages.playThisDifficultyAndSubmitAScoreToAppearHere')}
          </p>
        </div>
      ) : (
        <div
          className="min-w-0 overflow-x-auto rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
          tabIndex={0}
          role="region"
          aria-label={t('messages.scoreRankings')}
        >
          <Table>
            <TableCaption className="sr-only">
              {t('messages.difficultyLeaderboard', {
                difficulty: isSupportedCourse(course) ? courseNames[course] : course,
              })}
            </TableCaption>
            <TableHeader>
              <TableRow>
                {[
                  t('messages.rank'),
                  t('messages.player'),
                  t('messages.score'),
                  t('messages.good'),
                  t('messages.ok'),
                  t('messages.bad'),
                  t('messages.drumroll'),
                  t('messages.submitted'),
                ].map((label) => (
                  <TableHead scope="col" key={label}>
                    {label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((entry) => (
                <TableRow
                  key={entry.id}
                  className={entry.userId === user?.id ? 'bg-accent/50' : ''}
                >
                  <TableCell>
                    <span className="font-medium tabular-nums">#{entry.rank}</span>
                  </TableCell>
                  <TableHead scope="row">
                    <Link
                      className="inline-flex max-w-full items-center gap-2 align-middle text-link hover:underline"
                      to={`/users/${encodeURIComponent(entry.userId)}`}
                    >
                      <UserAvatar
                        nickname={entry.nickname}
                        avatarUrl={entry.avatarUrl}
                        className="size-6"
                        fallbackClassName="text-xs"
                      />
                      <span className="truncate">{entry.nickname}</span>
                    </Link>
                    <ProfilePlate userId={entry.userId} className="ml-2" />
                    {entry.userId === user?.id && (
                      <span className="ml-2 rounded-md bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
                        {t('messages.you')}
                      </span>
                    )}
                  </TableHead>
                  <TableCell className="font-semibold tabular-nums">
                    {entry.score.toLocaleString(formatLocale(i18n.resolvedLanguage))}
                  </TableCell>
                  <TableCell>
                    {entry.good.toLocaleString(formatLocale(i18n.resolvedLanguage))}
                  </TableCell>
                  <TableCell>
                    {entry.ok.toLocaleString(formatLocale(i18n.resolvedLanguage))}
                  </TableCell>
                  <TableCell>
                    {entry.bad.toLocaleString(formatLocale(i18n.resolvedLanguage))}
                  </TableCell>
                  <TableCell>
                    {entry.drumroll.toLocaleString(formatLocale(i18n.resolvedLanguage))}
                  </TableCell>
                  <TableCell>
                    <time dateTime={entry.submittedAt}>
                      {new Date(entry.submittedAt).toLocaleString(
                        formatLocale(i18n.resolvedLanguage),
                      )}
                    </time>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
          <Button
            variant="outline"
            size="default"
            disabled={page <= 1}
            onClick={() => setPage((n) => n - 1)}
          >
            {t('messages.previous')}
          </Button>
          <span>{t('messages.pagination', { page: page, pages: pages })}</span>
          <Button
            variant="outline"
            size="default"
            disabled={page >= pages || page >= 10000}
            onClick={() => setPage((n) => n + 1)}
          >
            {t('messages.next')}
          </Button>
        </div>
      )}
    </div>
  )
}
