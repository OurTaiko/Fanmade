import { chartOwners, isChartOwner } from './chart-owners'
import { CollaborationDialog } from './collaborations'
import { formatLocale } from '@/i18n'
import { chartText } from '@/chart-language'
import { buildChartPackage, packageFilename, saveBlob } from '@/chart-package'
import { i18n } from '@/i18n'
import { useTranslation } from 'react-i18next'
import { endpoints } from '@/api/endpoints'
import { DialogClose } from '@/components/ui/dialog'
import { ChartCover, CoverDialog } from '@/components/chart-cover'
import { AudioPlayer } from '@/components/audio-player'
import { buttonVariants, Button } from '@/components/ui/button'
import { ChartSearch, chartOrders, useChartOrderLabels } from '@/components/chart-search'
import type { ChartOrder } from '@/components/chart-search'
import { Skeleton } from '@/components/ui/skeleton'
import { Card } from '@/components/ui/card'
import { UserAvatar } from '@/components/user-avatar'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowRightIcon as ArrowRight,
  DownloadSimpleIcon as Download,
  UploadSimpleIcon as Upload,
  ArrowSquareOutIcon,
  ChatCircleIcon,
  CaretRightIcon,
} from '@phosphor-icons/react'
import { api, jsonRequest } from './api/client'
import type { Chart, ChartList } from './api/types'
import { ChartCard } from '@/components/chart-card'
import { supportsChart } from './courses'
import { useSession } from './session-context'
import { EditMetadata } from './edit-metadata'
import { ChartActivity, type ActivityTab } from './chart-activity'
import { Modal, Notice } from './notifications'
import { useNotification } from './notification-context'
import { CategoryLabels } from './categories'
import { CommentSection } from './comments'
import { VoteControl } from '@/components/vote-control'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { coverSource } from './cover'
import type { Vote, VoteResult } from './api/types'

export function Library({
  mine = false,
  ownerId,
  embedded = false,
}: {
  mine?: boolean
  ownerId?: string
  embedded?: boolean
}) {
  const { t } = useTranslation()
  const orderLabels = useChartOrderLabels()

  const [params, setParams] = useSearchParams(),
    { user, loading: authLoading } = useSession()
  const [data, setData] = useState<ChartList | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true)
  const [searchPending, setSearchPending] = useState(false)
  const search = useCallback(
    (query: string) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (query) next.set('q', query)
          else next.delete('q')
          next.set('page', '1')
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )
  const q = params.get('q') || '',
    order = chartOrders.includes(params.get('order') as ChartOrder)
      ? (params.get('order') as ChartOrder)
      : '',
    owner = mine ? '' : ownerId || params.get('owner') || '',
    page = Math.min(10000, Math.max(1, Math.floor(Number(params.get('page')) || 1)))
  useEffect(() => {
    if (mine && !user) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    api<ChartList>(endpoints.chartList({ q, order, page, ...(owner ? { owner } : {}) }, mine), {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setData(result)
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [mine, user, q, order, page, owner])
  if (mine && !user)
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-dashed bg-card/60 px-6 py-16 text-center [&>p]:max-w-lg [&>p]:text-muted-foreground">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('messages.yourCreationsStartHere')}
        </h1>
        <p>
          {authLoading
            ? t('messages.loadingAccount')
            : t('messages.signInToViewAndManageYourCharts')}
        </p>
        {!authLoading && (
          <Link className={buttonVariants({ variant: 'default', size: 'default' })} to="/login">
            {t('messages.signIn')}
            <ArrowRight size={16} />
          </Link>
        )}
      </div>
    )
  const update = (value: Record<string, string>) =>
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.set('page', '1')
      for (const [key, entry] of Object.entries(value)) {
        if (entry) next.set(key, entry)
        else next.delete(key)
      }
      return next
    })
  return (
    <>
      {!embedded && (
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center [&_p]:mt-2 [&_p]:text-sm [&_p]:text-muted-foreground">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {mine
                ? t('messages.myCharts')
                : owner
                  ? t('messages.userPublishedCharts')
                  : t('messages.discoverGreatCharts')}
            </h1>
            <p>
              {mine
                ? t('messages.manageYourChartsAndTurnInspirationIntoRhythm')
                : t('messages.findYourRhythmAndDiscoverChartCreatorsIdeas')}
            </p>
          </div>
          <Link className={buttonVariants({ variant: 'default', size: 'default' })} to="/upload">
            <Upload size={17} />
            {t('messages.publishChart')}
          </Link>
        </div>
      )}
      {owner && !embedded && (
        <Link to="/users" className="text-sm text-primary hover:underline">
          {t('messages.backToUserSquare')}
        </Link>
      )}
      <ChartSearch
        key={mine ? 'mine' : owner || 'all'}
        query={q}
        order={order}
        onSearch={search}
        onPendingChange={setSearchPending}
        onChange={update}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 [&_h2]:flex [&_h2]:items-center [&_h2]:gap-2 [&_h2_span]:text-muted-foreground">
        <h2 className="text-base font-semibold">
          {q ? t('messages.searchResults', { query: q }) : orderLabels[order]}
          {!searchPending && !loading && !error && data && <span>{data.total}</span>}
        </h2>
        {q && <span className="text-sm text-muted-foreground">{orderLabels[order]}</span>}
      </div>
      {error ? (
        <Notice>{error}</Notice>
      ) : loading ? (
        <div
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          aria-label={t('messages.loadingCharts')}
        >
          {[0, 1, 2].map((n) => (
            <Skeleton className="h-48 rounded-4xl" key={n} />
          ))}
        </div>
      ) : data?.items.length ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.items.map((chart) => (
              <ChartCard key={chart.id} chart={chart} />
            ))}
          </div>
          {data.total > data.pageSize && (
            <div className="flex flex-wrap items-center justify-center gap-4 py-4 text-sm">
              <Button
                variant="outline"
                size="default"
                disabled={page <= 1}
                onClick={() => update({ page: String(page - 1) })}
              >
                {t('messages.previous')}
              </Button>
              <span>
                {t('messages.pagination', {
                  page: page,
                  pages: Math.ceil(data.total / data.pageSize),
                })}
              </span>
              <Button
                variant="outline"
                size="default"
                disabled={page * data.pageSize >= data.total}
                onClick={() => update({ page: String(page + 1) })}
              >
                {t('messages.next')}
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-dashed bg-card/60 px-6 py-16 text-center [&>p]:max-w-lg [&>p]:text-muted-foreground">
          <h2 className="text-base font-semibold">
            {q
              ? t('messages.noMatchingCharts')
              : owner
                ? t('messages.noPublishedChartsYet')
                : t('messages.beTheFirstToShareARhythm')}
          </h2>
          <p>
            {q
              ? t('messages.tryOtherSearchFilters')
              : owner
                ? t('messages.memberHasNoPublicCharts')
                : t('messages.chooseATjaAndItsOggOrMp3AudioToGetStarted')}
          </p>
          {!owner && (
            <Link to="/upload" className={buttonVariants({ variant: 'outline', size: 'default' })}>
              {t('messages.publishChart')}
              <ArrowRight size={16} />
            </Link>
          )}
        </div>
      )}
    </>
  )
}

export function Auth({ register = false }: { register?: boolean }) {
  const { t } = useTranslation()

  const [params] = useSearchParams()
  const session = useSession()
  const destination = params.get('returnTo') || '/upload'
  return (
    <div className="mx-auto max-w-lg space-y-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {register ? t('messages.joinTheRhythm') : t('messages.welcomeBack')}
      </h1>
      <p className="text-sm text-muted-foreground">
        {t('messages.oneOurtaikoAccountForYourCreationsAndPlayRecords')}
      </p>
      <Card
        className="min-w-0 border p-5 shadow-none ring-0 sm:p-6 gap-4 p-6 [&>p]:text-muted-foreground"
        aria-label={t('messages.accountCenterSignIn')}
      >
        <h2 className="text-base font-semibold">
          {register
            ? t('messages.createAnAccountInTheAccountCenter')
            : t('messages.signInWithOurtaiko')}
        </h2>
        <p>{t('messages.signInNicknameAndPasswordAreManagedInTheAccountCenterYou')}</p>
        {params.has('error') && (
          <Notice>
            {t('messages.signInWasIncompleteOrAuthorizationExpiredPleaseSignInAgain')}
          </Notice>
        )}
        {session.error && <Notice>{session.error}</Notice>}
        <a
          className={buttonVariants({ variant: 'default', size: 'default', className: 'w-full' })}
          href={endpoints.login(destination)}
        >
          {t('messages.goToAccountCenter')}
          <ArrowRight size={17} />
        </a>
        <a
          className={buttonVariants({ variant: 'outline', size: 'default', className: 'w-full' })}
          href={endpoints.accountRegister}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('messages.createAnOurtaikoAccount')}
        </a>
        <p className="text-sm text-muted-foreground">
          {t('messages.registrationOpensInANewTabReturnHereToSignInWhen')}
        </p>
        {session.user && (
          <Link className={buttonVariants({ variant: 'outline', size: 'default' })} to="/upload">
            {t('messages.signedInContinuePublishing')}
          </Link>
        )}
      </Card>
    </div>
  )
}
const detailCardClassName =
  'rounded-2xl bg-white p-6 shadow-[0_4px_12px_rgba(0,0,0,0.08)] dark:bg-card'
const manageItemClassName =
  'flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm text-foreground transition-colors hover:text-[#0071e3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md'

type DetailSection = 'info' | 'activity' | 'comments'
type PageTab = 'info' | 'chart' | 'leaderboard' | 'comments'

export function Detail() {
  const { t } = useTranslation()

  const { notify } = useNotification()
  const { id, commentId } = useParams(),
    session = useSession(),
    navigate = useNavigate(),
    location = useLocation()
  const [chart, setChart] = useState<Chart | null>(null),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState(false),
    [leaving, setLeaving] = useState(false),
    [busy, setBusy] = useState(false),
    [packaging, setPackaging] = useState(false)
  const [editing, setEditing] = useState(false)
  const [coverEditing, setCoverEditing] = useState(false)
  const [collaborating, setCollaborating] = useState(false)
  const [saved, setSaved] = useState(false)
  const editButton = useRef<HTMLButtonElement>(null)
  // Below lg the page shows one section at a time; wider screens show them all.
  const [section, setSection] = useState<DetailSection>('info')
  const [activityTab, setActivityTab] = useState<ActivityTab>('image')
  useEffect(() => {
    const controller = new AbortController()
    setChart(null)
    setError('')
    setEditing(false)
    setCoverEditing(false)
    setCollaborating(false)
    setSaved(false)
    setConfirm(false)
    setLeaving(false)
    setActivityTab('image')
    if (!id) return
    api<Chart>(endpoints.chart(id), { signal: controller.signal })
      .then(setChart)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [id])
  useEffect(() => {
    setSection(commentId || location.hash === '#comments' ? 'comments' : 'info')
  }, [id, commentId, location.hash])
  // The archive is built here from the stored files; leaving the page cancels it.
  const packageRequest = useRef<AbortController | null>(null)
  useEffect(() => () => packageRequest.current?.abort(), [id])
  const downloadPackage = async () => {
    if (!chart) return
    const controller = new AbortController()
    packageRequest.current = controller
    setPackaging(true)
    try {
      const archive = await buildChartPackage(chart, controller.signal)
      saveBlob(archive, packageFilename(chartText(chart, i18n.resolvedLanguage).title))
    } catch {
      if (!controller.signal.aborted) notify(t('messages.chartPackageDownloadFailed'), 'error')
    } finally {
      if (packageRequest.current === controller) setPackaging(false)
    }
  }
  // Give up one's share of a co-owned chart; the other owners keep it.
  const leave = async () => {
    if (!chart) return
    setBusy(true)
    try {
      await api(endpoints.chartOwnership(chart.id), jsonRequest('DELETE', {}, session.csrfToken))
      setLeaving(false)
      setChart(await api<Chart>(endpoints.chart(chart.id)))
      notify(t('collaboration.left'), 'success')
    } catch (e) {
      setLeaving(false)
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!chart) return
    setError('')
    setBusy(true)
    try {
      await api(endpoints.chart(chart.id), jsonRequest('DELETE', {}, session.csrfToken))
      setConfirm(false)
      navigate('/me/charts')
      notify(t('messages.chartDeleted'), 'success')
    } catch (e) {
      setConfirm(false)
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (!id) return <Notice>{t('messages.missingSongId')}</Notice>
  if (!chart)
    return error ? (
      <Notice>{error}</Notice>
    ) : (
      <p className="text-sm text-muted-foreground">{t('messages.loadingChart')}</p>
    )
  if (!supportsChart(chart.difficulties))
    return <Notice>{t('messages.thisChartTypeIsNotSupported')}</Notice>
  const text = chartText(chart, i18n.resolvedLanguage)
  const isOwner = isChartOwner(chart, session.user?.id)
  const canManage = isOwner || !!session.user?.isAdmin
  const votes = chart.upvotes + chart.downvotes
  const pageTab: PageTab =
    section === 'activity' ? (activityTab === 'leaderboard' ? 'leaderboard' : 'chart') : section
  const selectPageTab = (value: PageTab) => {
    if (value === 'info' || value === 'comments') return setSection(value)
    setSection('activity')
    if (value === 'leaderboard') setActivityTab('leaderboard')
    else if (activityTab === 'leaderboard') setActivityTab('image')
  }
  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="chart-title"
        className="overflow-hidden rounded-2xl bg-white shadow-[0_4px_12px_rgba(0,0,0,0.08)] dark:bg-card"
      >
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-4 p-4 sm:grid-cols-[16rem_minmax(0,1fr)] sm:gap-x-8 sm:gap-y-5 sm:p-8 lg:grid-cols-[20rem_minmax(0,1fr)] lg:gap-x-10">
          <ChartCover chart={chart} className="sm:row-span-3" />
          <div className="flex min-w-0 flex-col gap-1 self-center sm:gap-2 sm:self-start">
            <CategoryLabels ids={chart.categoryIds} />
            <h1
              id="chart-title"
              className="text-xl font-semibold tracking-tight wrap-anywhere sm:text-4xl"
            >
              {text.title}
            </h1>
            {text.subtitle && (
              <p className="truncate text-sm text-muted-foreground sm:whitespace-normal sm:text-lg sm:wrap-anywhere">
                {text.subtitle}
              </p>
            )}
            <p data-testid="detail-facts" className="text-sm text-muted-foreground wrap-anywhere">
              {t('messages.chartCreator')}{' '}
              <span className="font-medium text-foreground">{chart.maker || chart.uploader}</span>
            </p>
          </div>
          <dl className="col-span-2 grid max-w-md grid-cols-3 gap-2 rounded-xl bg-[#f5f5f7] p-3 text-center sm:col-span-1 sm:col-start-2 sm:gap-4 sm:bg-transparent sm:p-0 sm:text-left dark:bg-muted sm:dark:bg-transparent">
            <div>
              <dt className="text-xs text-muted-foreground">BPM</dt>
              <dd className="text-base font-semibold tabular-nums sm:text-xl">{chart.bpm}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('messages.duration')}</dt>
              <dd className="text-base font-semibold tabular-nums sm:text-xl">
                {Math.floor(chart.duration / 60)}:
                {String(Math.floor(chart.duration % 60)).padStart(2, '0')}
              </dd>
            </div>
            {votes > 0 && (
              <div>
                <dt className="text-xs text-muted-foreground">{t('interactions.approval')}</dt>
                <dd className="text-base font-semibold tabular-nums sm:text-xl">
                  {Math.round((chart.upvotes / votes) * 100)}%
                </dd>
              </div>
            )}
          </dl>
          <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:col-start-2 sm:gap-3">
            <Button
              size="lg"
              className="h-11 flex-1 px-5 sm:flex-none"
              disabled={packaging}
              onClick={downloadPackage}
            >
              <Download size={18} aria-hidden="true" />
              {t(packaging ? 'messages.packagingChart' : 'messages.downloadChartPackage')}
            </Button>
            <a
              className={cn(
                buttonVariants({ variant: 'secondary', size: 'lg' }),
                'h-11 max-sm:hidden',
              )}
              href={endpoints.resource(chart, 'tja')}
            >
              <ArrowSquareOutIcon size={17} aria-hidden="true" />
              {t('messages.sourceFiles')}
            </a>
            <div className="hidden flex-1 sm:block" />
            <VoteControl
              className="rounded-full bg-[#f5f5f7] px-1 py-0.5 dark:bg-muted"
              score={chart.score}
              myVote={chart.myVote}
              label={t('interactions.voteOnChart')}
              onVote={(value: Vote) =>
                api<VoteResult>(
                  endpoints.chartVote(chart.id),
                  jsonRequest('PUT', { value }, session.csrfToken),
                )
              }
              onResult={(result) =>
                setChart((current) =>
                  current?.id === chart.id ? { ...current, ...result } : current,
                )
              }
            />
            <a
              href="#comments"
              onClick={() => setSection('comments')}
              className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground hover:text-foreground max-sm:hidden"
            >
              <ChatCircleIcon size={18} aria-hidden="true" />
              {t('interactions.commentCount', { count: chart.commentCount })}
            </a>
          </div>
        </div>
        <AudioPlayer
          compact
          className="rounded-none border-0 border-t bg-[#fbfbfd] px-4 py-3 sm:px-8 dark:bg-muted/40"
          label={t('messages.audioPreview')}
          src={endpoints.resource(chart, 'audio')}
          startAt={chart.demoStart}
          knownDuration={chart.duration}
        />
      </section>
      {error && <Notice>{error}</Notice>}
      {saved && (
        <Modal
          title={t('messages.success')}
          finalFocus={editButton}
          onDismiss={() => setSaved(false)}
        >
          {t('messages.chartInformationSaved')}
        </Modal>
      )}
      {editing && canManage && (
        <EditMetadata
          key={chart.id}
          chart={chart}
          csrf={session.csrfToken}
          onDismiss={() => setEditing(false)}
          onSaved={(updated) => {
            setChart(updated)
            setEditing(false)
            setSaved(true)
          }}
        />
      )}
      {collaborating && isOwner && (
        <CollaborationDialog chart={chart} onDismiss={() => setCollaborating(false)} />
      )}
      {coverEditing && canManage && (
        <CoverDialog
          chart={chart}
          onDismiss={() => setCoverEditing(false)}
          onSaved={(coverHash) =>
            setChart((current) => (current?.id === chart.id ? { ...current, coverHash } : current))
          }
        />
      )}
      <Tabs
        value={pageTab}
        onValueChange={(value) => selectPageTab(value as PageTab)}
        className="lg:hidden"
      >
        <TabsList
          aria-label={t('messages.chartSections')}
          className="grid h-auto w-full grid-cols-4 gap-0.5 rounded-full bg-[#e8e8ed] p-1 dark:bg-muted"
        >
          {(
            [
              ['info', t('messages.aboutThisChart')],
              ['chart', t('messages.chartTab')],
              ['leaderboard', t('messages.leaderboard')],
              ['comments', t('interactions.commentsHeading', { count: chart.commentCount })],
            ] as const
          ).map(([value, label]) => (
            <TabsTrigger
              key={value}
              value={value}
              className="h-9 min-w-0 truncate rounded-full px-2 text-sm font-medium text-muted-foreground after:hidden data-active:bg-white data-active:text-foreground data-active:shadow-sm dark:data-active:bg-card"
            >
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div
          className={cn(
            'flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-1',
            section === 'info' && 'max-lg:hidden',
          )}
        >
          <div className={cn('min-w-0', section !== 'activity' && 'max-lg:hidden')}>
            <ChartActivity
              key={`${chart.id}:${chart.tjaHash}:${chart.audioHash}`}
              chart={chart}
              tab={activityTab}
              onTabChange={setActivityTab}
            />
          </div>
          <div className={cn('min-w-0', section !== 'comments' && 'max-lg:hidden')}>
            <CommentSection
              chart={chart}
              focusId={commentId}
              onCountChange={(delta) =>
                setChart((current) =>
                  current?.id === chart.id
                    ? { ...current, commentCount: Math.max(0, current.commentCount + delta) }
                    : current,
                )
              }
            />
          </div>
        </div>
        <aside
          className={cn(
            'flex min-w-0 flex-col gap-6 lg:col-start-2 lg:row-start-1',
            section !== 'info' && 'max-lg:hidden',
          )}
        >
          <section
            aria-labelledby="chart-description-heading"
            className={cn(detailCardClassName, 'space-y-3')}
          >
            <h2 id="chart-description-heading" className="text-lg font-semibold tracking-tight">
              {t('messages.aboutThisChart')}
            </h2>
            <p className="whitespace-pre-wrap text-sm leading-7 text-muted-foreground wrap-anywhere">
              {chart.description || t('messages.noDescriptionFromTheUploaderYet')}
            </p>
          </section>
          <section
            aria-labelledby="chart-submission-heading"
            className={cn(detailCardClassName, 'space-y-4')}
          >
            <h2 id="chart-submission-heading" className="text-lg font-semibold tracking-tight">
              {t('messages.submissionDetails')}
            </h2>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm [&>dt]:text-muted-foreground [&>dd]:wrap-anywhere">
              <dt className="self-center">{t('collaboration.owners')}</dt>
              <dd className="flex flex-wrap gap-3">
                {chartOwners(chart).map((owner) => (
                  <Link
                    key={owner.id}
                    className="inline-flex max-w-full items-center gap-2 align-middle text-primary hover:underline"
                    to={`/users/${encodeURIComponent(owner.id)}`}
                  >
                    <UserAvatar
                      nickname={owner.nickname}
                      avatarUrl={owner.avatarUrl}
                      className="size-6"
                      fallbackClassName="text-xs"
                    />
                    <span className="min-w-0 wrap-anywhere">{owner.nickname}</span>
                  </Link>
                ))}
              </dd>
              <dt>{t('messages.published')}</dt>
              <dd>
                {new Date(chart.createdAt).toLocaleDateString(formatLocale(i18n.resolvedLanguage))}
              </dd>
              {/* The header shows this link from sm up. */}
              <dt className="sm:hidden">{t('messages.sourceFiles')}</dt>
              <dd className="sm:hidden">
                <a className="text-primary hover:underline" href={endpoints.resource(chart, 'tja')}>
                  TJA
                </a>
              </dd>
            </dl>
          </section>
          {canManage && (
            <section
              aria-labelledby="chart-manage-heading"
              className={cn(detailCardClassName, 'space-y-1')}
            >
              <h2 id="chart-manage-heading" className="pb-2 text-lg font-semibold tracking-tight">
                {t('messages.manageChart')}
              </h2>
              <ul className="divide-y">
                <li>
                  <Link className={manageItemClassName} to={`/charts/${chart.id}/update`}>
                    {t('messages.updateSongAndCharts')}
                    <CaretRightIcon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
                <li>
                  <button
                    ref={editButton}
                    type="button"
                    className={manageItemClassName}
                    onClick={() => {
                      setSaved(false)
                      setEditing(true)
                    }}
                  >
                    {t('messages.editInformation')}
                    <CaretRightIcon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </button>
                </li>
                {canManage && (
                  <li>
                    <button
                      type="button"
                      className={manageItemClassName}
                      onClick={() => setCoverEditing(true)}
                    >
                      {coverSource(chart) ? t('messages.changeCover') : t('messages.addCover')}
                      <CaretRightIcon
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                )}
                {isOwner && (
                  <li>
                    <button
                      type="button"
                      className={manageItemClassName}
                      onClick={() => setCollaborating(true)}
                    >
                      {t('collaboration.add')}
                      <CaretRightIcon
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                )}
                {isOwner && chartOwners(chart).length > 1 && (
                  <li>
                    <button
                      type="button"
                      className={manageItemClassName}
                      onClick={() => setLeaving(true)}
                    >
                      {t('collaboration.leave')}
                    </button>
                  </li>
                )}
                {isOwner && (
                  <li>
                    <button
                      type="button"
                      className={cn(manageItemClassName, 'text-destructive hover:text-destructive')}
                      onClick={() => setConfirm(true)}
                    >
                      {t('messages.deleteChart')}
                    </button>
                  </li>
                )}
              </ul>
              {leaving && (
                <Modal
                  title={t('collaboration.leaveTitle')}
                  busy={busy}
                  onDismiss={() => setLeaving(false)}
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
                        variant="destructive"
                        size="default"
                        disabled={busy}
                        onClick={leave}
                      >
                        {busy ? t('collaboration.leavingNow') : t('collaboration.leaveConfirm')}
                      </Button>
                    </>
                  }
                >
                  {t('collaboration.leaveDescription')}
                </Modal>
              )}
              {confirm && (
                <Modal
                  title={t('messages.deleteThisChart')}
                  busy={busy}
                  onDismiss={() => setConfirm(false)}
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
                        variant="destructive"
                        size="default"
                        disabled={busy}
                        onClick={remove}
                      >
                        {busy ? t('messages.deleting') : t('messages.confirmDeletion')}
                      </Button>
                    </>
                  }
                >
                  {t('messages.theChartAndDownloadLinkWillNoLongerBePublicAfterDeletion')}
                </Modal>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}
