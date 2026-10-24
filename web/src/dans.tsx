import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CommentSection, danSubject } from '@/comments'
import { danTitle } from '@/dan-title'
export { danTitle }
import { VoteControl } from '@/components/vote-control'
import {
  ChatCircleIcon,
  ArrowClockwiseIcon,
  MedalIcon,
  PencilSimpleIcon,
  PlusIcon,
  SealCheckIcon,
  TrashIcon,
  WarningIcon,
  XIcon,
} from '@phosphor-icons/react'
import { api, jsonRequest } from '@/api/client'
import { endpoints } from '@/api/endpoints'
import type {
  Chart,
  ChartList,
  Dan,
  DanExam,
  DanInput,
  DanRewardTitle,
  Vote,
  VoteResult,
} from '@/api/types'
import { chartText } from '@/chart-language'
import { ChoiceSelect } from '@/components/choice-select'
import { SearchInput } from '@/components/search-input'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal, Notice } from '@/notifications'
import {
  TitleBand,
  profileTitlesPage,
  titleText,
  titleUsableBy,
  useProfileTitles,
} from '@/profile-titles'
import { useSession } from '@/session-context'
import { cn } from '@/lib/utils'

// 段位 courses as OurTaikoPlay plays them (one to three songs with conditions). The game reads
// them from this server; passing an official one gives a 段位 badge on OurTaikoProfile.

export const danNames = [
  '初級',
  '十級',
  '九級',
  '八級',
  '七級',
  '六級',
  '五級',
  '四級',
  '三級',
  '二級',
  '一級',
  '初段',
  '二段',
  '三段',
  '四段',
  '五段',
  '六段',
  '七段',
  '八段',
  '九段',
  '十段',
  '玄人',
  '名人',
  '超人',
  '達人',
] as const
const titleLanguages = ['ja', 'en', 'zh', 'ko'] as const
const examTypes = ['gauge', 'good', 'ok', 'bad', 'hits', 'score', 'combo', 'rolls'] as const
const rewardLevels = ['red', 'red2', 'red3', 'gold', 'gold5', 'gold6'] as const
const courses = ['Easy', 'Normal', 'Hard', 'Oni', 'Edit'] as const
// The dan box colours of the Nijiiro skin's dan_select/box/folder, which the game draws the
// course's box, its yellow board and its loading plaque with. The skin's 1 is the same wood
// as 0, so it is not offered (the backend refuses it too).
const danColors = [
  { value: 0, name: 'wood', hex: '#FCCB73' },
  { value: 2, name: 'blue', hex: '#47A7B8' },
  { value: 3, name: 'red', hex: '#F15134' },
  { value: 4, name: 'silver', hex: '#D9DEE5' },
  { value: 5, name: 'gold', hex: '#DCC15F' },
  { value: 6, name: 'green', hex: '#499875' },
] as const

function ColorSwatch({ hex }: { hex: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-3.5 shrink-0 rounded-sm border border-black/20"
      style={{ backgroundColor: hex }}
    />
  )
}
// The game offers 五級 (6) .. 達人 (24); 0–5 exist in the numbering only.
const danFirst = 6
// A player publishes at most this many courses that are not official.
const communityLimit = 10

function Line({ value }: { value: number[] | null }) {
  const { t } = useTranslation()
  if (!value) return <span className="text-muted-foreground">—</span>
  return (
    <span className="tabular-nums">
      <span className="text-red-600 dark:text-red-400">{value[0]}</span>
      {value.length > 1 && (
        <>
          {' / '}
          <span className="text-amber-600 dark:text-amber-400">{value[1]}</span>
        </>
      )}
      <span className="sr-only">{value.length > 1 ? t('dans.redGold') : t('dans.red')}</span>
    </span>
  )
}

function ExamTable({ dan }: { dan: Dan }) {
  const { t } = useTranslation()
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-muted-foreground">
        <tr>
          <th className="py-1 font-normal">{t('dans.exam')}</th>
          <th className="py-1 font-normal">{t('dans.whole')}</th>
          {dan.songs.map((_, i) => (
            <th key={i} className="py-1 font-normal">
              {t('dans.songNumber', { number: i + 1 })}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {dan.exams.map((exam, i) => {
          const perSong = Array.isArray(exam.value[0]) || exam.value[0] === null
          return (
            <tr key={i} className="border-t">
              <td className="py-2">
                {t(`dans.examTypes.${exam.type}`)} {t(`dans.ranges.${exam.range}`)}
              </td>
              <td className="py-2">{perSong ? '—' : <Line value={exam.value as number[]} />}</td>
              {dan.songs.map((_, song) => (
                <td key={song} className="py-2">
                  {perSong ? (
                    <Line value={(exam.value as (number[] | null)[])[song] ?? null} />
                  ) : (
                    '—'
                  )}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// Garbled text that stands in for a hidden title: the same for a song every time, and its
// length says nothing about the real title.
const garbleGlyphs = '縺繧譁蟄怜喧縺代ｦ繝ｼ繧ｹ蜷榊燕螟ｱ謨鈴擇蛻'
function garble(seed: string) {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  let text = ''
  for (let i = 0; i < 8; i++) {
    // mulberry32
    h = (h + 0x6d2b79f5) | 0
    let x = Math.imul(h ^ (h >>> 15), h | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    text += garbleGlyphs[((x ^ (x >>> 14)) >>> 0) % garbleGlyphs.length]
  }
  return text
}

function HiddenTitle({ seed }: { seed: string }) {
  const { t } = useTranslation()
  return (
    <span className="font-medium text-muted-foreground" aria-label={t('dans.hiddenTitle')}>
      <span aria-hidden="true">{garble(seed)}</span>
    </span>
  )
}

function DanCard({ dan }: { dan: Dan }) {
  const { t, i18n } = useTranslation()
  const session = useSession()
  const isOwner = session.user?.id === dan.ownerId
  const unavailable = dan.songs.some((s) => !s.available)
  return (
    <Link
      to={`/dans/${dan.id}`}
      className="block rounded-[14px] border-2 border-outline bg-card p-5 shadow-drop transition hover:-translate-y-0.5 hover:shadow-drop-hover motion-reduce:transform-none"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-extrabold">
            {danTitle(dan.title, i18n.resolvedLanguage)}
          </h2>
          <p className="text-xs text-muted-foreground">
            {dan.owner || t('dans.unknownOwner')}
            <span aria-hidden="true"> · </span>
            {t('interactions.points', { count: dan.score })}
            <span aria-hidden="true"> · </span>
            {t('interactions.commentCount', { count: dan.commentCount })}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {dan.official && (
            <Badge>
              <SealCheckIcon aria-hidden="true" />
              {t('dans.official')}
            </Badge>
          )}
          {unavailable && (
            <Badge variant="destructive">
              <WarningIcon aria-hidden="true" />
              {t('dans.unavailable')}
            </Badge>
          )}
        </div>
      </div>
      <ol className="mt-4 space-y-1 text-sm">
        {dan.songs.map((song, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-muted-foreground tabular-nums">{i + 1}</span>
            {song.hidden && !isOwner ? (
              <span className="truncate">
                <HiddenTitle seed={`${dan.id}/${i}`} />
              </span>
            ) : (
              <span className="truncate">{song.title}</span>
            )}
            {song.hidden && (
              <Badge variant="outline" className="shrink-0">
                {t('dans.hiddenTitle')}
              </Badge>
            )}
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {t(`dans.courses.${song.chart.course}`)} ★{song.level}
              {song.chart.side !== 'single' && ` · ${t(`dans.sides.${song.chart.side}`)}`}
            </span>
          </li>
        ))}
      </ol>
    </Link>
  )
}

export function DansPage() {
  const { t } = useTranslation()
  const session = useSession()
  const [dans, setDans] = useState<Dan[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    api<{ dans: Dan[] }>(endpoints.dans, { signal: controller.signal })
      .then((r) => setDans(r.dans))
      .catch((e: Error) => !controller.signal.aborted && setError(e.message))
    return () => controller.abort()
  }, [])
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-extrabold">{t('dans.heading')}</h1>
        </div>
        {session.user && (
          <Link className={buttonVariants()} to="/dans/new">
            <PlusIcon aria-hidden="true" />
            {t('dans.create')}
          </Link>
        )}
      </div>
      {error && <Notice>{error}</Notice>}
      {!dans && !error && <p role="status">{t('dans.loading')}</p>}
      {dans?.length === 0 && (
        <p className="py-12 text-center text-muted-foreground">{t('dans.empty')}</p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {dans?.map((dan) => (
          <DanCard key={dan.id} dan={dan} />
        ))}
      </div>
    </div>
  )
}

export function DanPage() {
  const { t, i18n } = useTranslation()
  const { id = '', commentId } = useParams()
  const session = useSession()
  const navigate = useNavigate()
  const [dan, setDan] = useState<Dan | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { titles: profileTitles } = useProfileTitles()
  useEffect(() => {
    const controller = new AbortController()
    api<Dan>(endpoints.dan(id), { signal: controller.signal })
      .then(setDan)
      .catch((e: Error) => !controller.signal.aborted && setError(e.message))
    return () => controller.abort()
  }, [id])
  if (error) return <Notice>{error}</Notice>
  if (!dan) return <p role="status">{t('dans.loading')}</p>
  const canEdit = session.user && (session.user.id === dan.ownerId || session.user.isAdmin)
  const isOwner = session.user?.id === dan.ownerId
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-6">
      <Card className="rounded-[14px]">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-3xl tracking-tight">
              {danTitle(dan.title, i18n.resolvedLanguage)}
            </CardTitle>
            {dan.official ? (
              <Badge>{t('dans.official')}</Badge>
            ) : (
              <Badge variant="secondary">{t('dans.community')}</Badge>
            )}
          </div>
          <CardDescription>
            {t('dans.by', { owner: dan.owner || t('dans.unknownOwner') })}
          </CardDescription>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t('dans.code')}</span>
            <code className="rounded-md bg-muted px-2 py-0.5 font-mono text-base tracking-[0.2em]">
              {dan.code}
            </code>
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <VoteControl
              className="rounded-full bg-muted px-1 py-0.5"
              score={dan.score}
              myVote={dan.myVote}
              label={t('interactions.voteOnDan')}
              onVote={(value: Vote) =>
                api<VoteResult>(
                  endpoints.danVote(dan.id),
                  jsonRequest('PUT', { value }, session.csrfToken),
                )
              }
              onResult={(result) =>
                setDan((current) => (current?.id === dan.id ? { ...current, ...result } : current))
              }
            />
            <a
              href="#comments"
              className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground hover:text-foreground"
            >
              <ChatCircleIcon size={18} aria-hidden="true" />
              {t('interactions.commentCount', { count: dan.commentCount })}
            </a>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {dan.songs.some((s) => !s.available) && <Notice>{t('dans.unavailableExplained')}</Notice>}
          <section className="space-y-2">
            <h2 className="font-extrabold">{t('dans.songs')}</h2>
            <ol className="space-y-2">
              {dan.songs.map((song, i) => (
                <li
                  key={i}
                  className={cn(
                    'flex flex-wrap items-center gap-3 rounded-[14px] border p-3',
                    !song.available && 'opacity-60',
                  )}
                >
                  <span className="text-lg font-bold tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  {song.hidden && !isOwner ? (
                    <HiddenTitle seed={`${dan.id}/${i}`} />
                  ) : (
                    <Link
                      to={`/charts/${song.chart.id}`}
                      className="min-w-0 font-medium hover:underline"
                    >
                      {song.title}
                      {song.subtitle && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {song.subtitle.replace(/^(--|\+\+)/, '')}
                        </span>
                      )}
                    </Link>
                  )}
                  <span className="ml-auto text-sm text-muted-foreground">
                    {t(`dans.courses.${song.chart.course}`)} ★{song.level}
                    {song.chart.side !== 'single' && ` · ${t(`dans.sides.${song.chart.side}`)}`}
                  </span>
                  {song.hidden && <Badge variant="outline">{t('dans.hiddenTitle')}</Badge>}
                  {!song.available && <Badge variant="destructive">{t('dans.changed')}</Badge>}
                </li>
              ))}
            </ol>
          </section>
          <section className="space-y-2">
            <h2 className="font-extrabold">{t('dans.exams')}</h2>
            <ExamTable dan={dan} />
            <p className="text-xs text-muted-foreground">{t('dans.examsExplained')}</p>
          </section>
          <section className="space-y-2">
            <h2 className="font-extrabold">{t('dans.rewards')}</h2>
            <ul className="space-y-1 text-sm">
              {dan.rewards.dan !== undefined && (
                <li className="flex items-center gap-2">
                  <MedalIcon className="size-4 shrink-0" aria-hidden="true" />
                  {t('dans.rewardDan', { dan: danNames[dan.rewards.dan] })}
                  {!dan.official && (
                    <span className="text-muted-foreground">
                      {t('dans.rewardDanNeedsOfficial')}
                    </span>
                  )}
                </li>
              )}
              {(dan.rewards.titles ?? []).map((reward) => {
                const title = profileTitles?.find((p) => p.id === reward.id)
                return (
                  <li key={reward.id + reward.on} className="flex flex-wrap items-center gap-2">
                    {title ? (
                      <TitleBand title={title} language={i18n.resolvedLanguage} />
                    ) : (
                      <code className="text-xs">{reward.id}</code>
                    )}
                    <span>{t(`dans.levels.${reward.on}`)}</span>
                    {title?.official && !dan.official && (
                      <span className="text-muted-foreground">
                        {t('dans.rewardDanNeedsOfficial')}
                      </span>
                    )}
                    {profileTitles && !title && (
                      <span className="text-destructive">{t('dans.titleMissing')}</span>
                    )}
                    {title && !titleUsableBy(title, dan.ownerId) && (
                      <span className="text-destructive">{t('dans.titleNotUsable')}</span>
                    )}
                  </li>
                )
              })}
              {dan.rewards.dan === undefined && !dan.rewards.titles?.length && (
                <li className="text-muted-foreground">{t('dans.noRewards')}</li>
              )}
            </ul>
          </section>
          {(canEdit || session.user?.isAdmin) && (
            <div className="flex flex-wrap gap-2 border-t pt-4">
              {canEdit && (
                <Link
                  className={buttonVariants({ variant: 'outline' })}
                  to={`/dans/${dan.id}/edit`}
                >
                  <PencilSimpleIcon aria-hidden="true" />
                  {t('dans.edit')}
                </Link>
              )}
              {session.user?.isAdmin && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api(
                        endpoints.danOfficial(dan.id),
                        jsonRequest('PUT', { official: !dan.official }, session.csrfToken),
                      )
                      setDan({ ...dan, official: !dan.official })
                    })
                  }
                >
                  <SealCheckIcon aria-hidden="true" />
                  {dan.official ? t('dans.unmarkOfficial') : t('dans.markOfficial')}
                </Button>
              )}
              {canEdit && (
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(t('dans.confirmDelete'))) return
                    void run(async () => {
                      await api(endpoints.dan(dan.id), {
                        ...jsonRequest('DELETE', {}, session.csrfToken),
                      })
                      navigate('/dans')
                    })
                  }}
                >
                  <TrashIcon aria-hidden="true" />
                  {t('dans.delete')}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      <CommentSection
        subject={danSubject(dan)}
        focusId={commentId}
        onCountChange={(delta) =>
          setDan((current) =>
            current?.id === dan.id
              ? { ...current, commentCount: Math.max(0, current.commentCount + delta) }
              : current,
          )
        }
      />
    </div>
  )
}

// Picks one public song (and shows its courses) for a course's slot.
function SongPicker({
  onPick,
  onDismiss,
}: {
  onPick: (chart: Chart) => void
  onDismiss: () => void
}) {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<ChartList | null>(null)
  const [error, setError] = useState('')
  const search = useCallback((value: string) => setQuery(value), [])
  useEffect(() => {
    const controller = new AbortController()
    setResult(null)
    api<ChartList>(endpoints.chartList({ q: query, page: 1 }), { signal: controller.signal })
      .then(setResult)
      .catch((e: Error) => !controller.signal.aborted && setError(e.message))
    return () => controller.abort()
  }, [query])
  return (
    <Modal title={t('dans.pickSong')} onDismiss={onDismiss}>
      <SearchInput value={query} onSearch={search} onPendingChange={() => {}} />
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {!result && !error && <p role="status">{t('dans.loading')}</p>}
      <ul className="max-h-80 space-y-2 overflow-y-auto">
        {result?.items.map((chart) => {
          const text = chartText(chart, i18n.resolvedLanguage)
          return (
            <li key={chart.id}>
              <button
                type="button"
                className="w-full rounded-[14px] border p-3 text-left hover:bg-accent"
                onClick={() => onPick(chart)}
              >
                <span className="block font-medium">{text.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {[text.subtitle, chart.maker || chart.uploader].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}

type SongBlock = { course: string; side: string; level: number }
type SongSlot = {
  chartId: string
  title: string
  /** The blocks the chart has; the maker must pick one (no default). */
  blocks: SongBlock[]
  course: string
  side: string
  hidden: boolean
}
type ExamRow = {
  type: DanExam['type']
  range: 'more' | 'less'
  perSong: boolean
  values: string[][]
}

const sides = ['single', 'p1', 'p2'] as const
/** Every block of the chart, Easy to Edit and single, 1P, 2P: the game plays exactly one. */
function slotBlocks(chart: Chart): SongBlock[] {
  return courses.flatMap((course) =>
    sides.flatMap((side) => {
      const d = chart.difficulties.find((x) => x.course === course && x.side === side)
      return d ? [{ course: d.course, side: d.side, level: d.level }] : []
    }),
  )
}
const blockKey = (b: { course: string; side: string }) => `${b.course}/${b.side}`

function toExamRows(exams: DanExam[], songs: number): ExamRow[] {
  return exams.map((exam) => {
    const perSong = Array.isArray(exam.value[0]) || exam.value[0] === null
    const line = (v: number[] | null) =>
      v ? [String(v[0]), v.length > 1 ? String(v[1]) : ''] : ['', '']
    return {
      type: exam.type,
      range: exam.range,
      perSong,
      values: perSong
        ? Array.from({ length: songs }, (_, i) =>
            line((exam.value as (number[] | null)[])[i] ?? null),
          )
        : [line(exam.value as number[])],
    }
  })
}

function fromExamRows(rows: ExamRow[], songs: number): DanExam[] {
  const line = ([red, gold]: string[]) =>
    red.trim() === '' ? null : gold.trim() === '' ? [Number(red)] : [Number(red), Number(gold)]
  return rows.map((row) => ({
    type: row.type,
    range: row.range,
    value: row.perSong
      ? Array.from({ length: songs }, (_, i) => line(row.values[i] ?? ['', '']))
      : (line(row.values[0]) ?? []),
  }))
}

export function DanEditorPage() {
  const { t, i18n } = useTranslation()
  const { id } = useParams()
  const session = useSession()
  const navigate = useNavigate()
  const [titles, setTitles] = useState<Record<string, string>>({ ja: '' })
  const [color, setColor] = useState(0)
  const [code, setCode] = useState('')
  const [songs, setSongs] = useState<SongSlot[]>([])
  const [exams, setExams] = useState<ExamRow[]>([
    { type: 'gauge', range: 'more', perSong: false, values: [['100', '']] },
  ])
  const [rewardDan, setRewardDan] = useState('none')
  const [rewardTitles, setRewardTitles] = useState<DanRewardTitle[]>([])
  // Who made the course being changed (its titles must be theirs) and whether it is official.
  const [made, setMade] = useState<{ owner: string; official: boolean } | null>(null)
  const [picking, setPicking] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const profile = useProfileTitles()
  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    api<Dan>(endpoints.dan(id), { signal: controller.signal })
      .then(async (dan) => {
        setMade({ owner: dan.ownerId, official: dan.official })
        setTitles(dan.title)
        setColor(dan.color)
        setCode(dan.code)
        setExams(toExamRows(dan.exams, dan.songs.length))
        setRewardDan(dan.rewards.dan === undefined ? 'none' : String(dan.rewards.dan))
        setRewardTitles(dan.rewards.titles ?? [])
        const charts = await Promise.all(
          dan.songs.map((s) =>
            api<Chart>(endpoints.chart(String(s.chart.id)), { signal: controller.signal }).catch(
              () => null,
            ),
          ),
        )
        setSongs(
          dan.songs.map((s, i) => ({
            chartId: String(s.chart.id),
            title: s.title,
            blocks: charts[i]
              ? slotBlocks(charts[i])
              : [{ course: s.chart.course, side: s.chart.side, level: s.level }],
            course: s.chart.course,
            side: s.chart.side,
            hidden: s.hidden,
          })),
        )
      })
      .catch((e: Error) => !controller.signal.aborted && setError(e.message))
    return () => controller.abort()
  }, [id])
  if (session.loading) return null
  if (!session.user) return <Notice>{t('dans.signInToEdit')}</Notice>
  const owner = made?.owner ?? session.user.id
  const official = made?.official ?? false
  // The titles this course may give, and any it already names that it may not (kept so that
  // saving shows why).
  const usable = (profile.titles ?? []).filter((title) => titleUsableBy(title, owner))
  const titleItems = (current: string) => {
    const items = usable.map((title) => ({
      value: title.id,
      label: `${titleText(title, i18n.resolvedLanguage)}（${title.official ? t('dans.official') : t('dans.community')}）`,
    }))
    return current && !usable.some((title) => title.id === current)
      ? [{ value: current, label: current }, ...items]
      : items
  }
  const setSongCount = (next: SongSlot[]) => {
    setSongs(next)
    setExams((rows) =>
      rows.map((row) => ({
        ...row,
        values: row.perSong
          ? Array.from({ length: next.length }, (_, i) => row.values[i] ?? ['', ''])
          : row.values,
      })),
    )
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (songs.some((s) => !s.side)) {
      setError(t('dans.sideRequired'))
      return
    }
    setBusy(true)
    setError('')
    const body: DanInput = {
      title: Object.fromEntries(Object.entries(titles).filter(([, v]) => v.trim())),
      color,
      ...(!id && code.trim() ? { code: code.trim().toUpperCase() } : {}),
      songs: songs.map((s) => ({
        chartId: s.chartId,
        course: s.course,
        side: s.side,
        hidden: s.hidden,
      })),
      exams: fromExamRows(exams, songs.length),
      rewards: {
        ...(rewardDan === 'none' ? {} : { dan: Number(rewardDan) }),
        titles: rewardTitles.filter((r) => r.id.trim()),
      },
    }
    try {
      const saved = await api<Dan>(
        id ? endpoints.dan(id) : endpoints.dans,
        jsonRequest(id ? 'PUT' : 'POST', body, session.csrfToken),
      )
      navigate(`/dans/${saved.id}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="space-y-6" onSubmit={(e) => void save(e)}>
      <h1 className="text-3xl font-extrabold">
        {id ? t('dans.editHeading') : t('dans.createHeading')}
      </h1>
      {!id && (
        <p className="text-sm text-muted-foreground">
          {t('dans.limitExplained', { limit: communityLimit })}
        </p>
      )}
      {error && <Notice>{error}</Notice>}
      <Card className="rounded-[14px]">
        <CardHeader>
          <CardTitle>{t('dans.basics')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {titleLanguages.map((language) => (
            <div key={language} className="space-y-2">
              <Label htmlFor={`dan-title-${language}`}>
                {t('dans.titleIn', { language: t(`dans.languages.${language}`) })}
              </Label>
              <Input
                id={`dan-title-${language}`}
                maxLength={40}
                value={titles[language] ?? ''}
                onChange={(e) => setTitles({ ...titles, [language]: e.target.value })}
              />
            </div>
          ))}
          <ChoiceSelect
            label={t('dans.color')}
            value={String(color)}
            onValueChange={(v) => setColor(Number(v))}
            prefix={
              <ColorSwatch hex={(danColors.find((c) => c.value === color) ?? danColors[0]).hex} />
            }
            items={danColors.map((c) => ({
              value: String(c.value),
              label: t('dans.colorNamed', { name: t(`dans.colors.${c.name}`), number: c.value }),
              icon: <ColorSwatch hex={c.hex} />,
            }))}
          />
          <div className="space-y-2">
            <Label htmlFor="dan-code">{t('dans.code')}</Label>
            <Input
              id="dan-code"
              value={code}
              readOnly={!!id}
              maxLength={6}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              pattern="[A-Za-z0-9]{6}"
              placeholder={id ? '' : t('dans.codePlaceholder')}
              className="font-mono uppercase tracking-[0.2em]"
              onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())}
            />
            <p className="text-xs text-muted-foreground">
              {id ? t('dans.codeFixed') : t('dans.codeHint')}
            </p>
          </div>
        </CardContent>
      </Card>
      <Card className="rounded-[14px]">
        <CardHeader>
          <CardTitle>{t('dans.songs')}</CardTitle>
          <CardDescription>{t('dans.songsExplained')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {songs.map((song, i) => (
            <div key={i} className="flex flex-wrap items-center gap-3 rounded-[14px] border p-3">
              <span className="text-lg font-bold tabular-nums text-muted-foreground">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{song.title}</span>
              <ChoiceSelect
                label={t('dans.side')}
                value={song.side ? blockKey(song) : ''}
                onValueChange={(v) => {
                  const [course, side] = v.split('/')
                  setSongs(songs.map((s, j) => (j === i ? { ...s, course, side } : s)))
                }}
                items={song.blocks.map((b) => ({
                  value: blockKey(b),
                  label: `${t(`dans.courses.${b.course as (typeof courses)[number]}`)} ★${b.level} · ${t(`dans.sides.${b.side as (typeof sides)[number]}`)}`,
                }))}
              />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={song.hidden}
                  onCheckedChange={(v) =>
                    setSongs(songs.map((s, j) => (j === i ? { ...s, hidden: Boolean(v) } : s)))
                  }
                />
                {t('dans.hidden')}
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('dans.removeSong')}
                onClick={() => setSongCount(songs.filter((_, j) => j !== i))}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </div>
          ))}
          {songs.length < 3 && (
            <Button type="button" variant="outline" onClick={() => setPicking(songs.length)}>
              <PlusIcon aria-hidden="true" />
              {t('dans.addSong')}
            </Button>
          )}
        </CardContent>
      </Card>
      <Card className="rounded-[14px]">
        <CardHeader>
          <CardTitle>{t('dans.exams')}</CardTitle>
          <CardDescription>{t('dans.examsEditExplained')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {exams.map((row, i) => (
            <div key={i} className="space-y-3 rounded-[14px] border p-3">
              <div className="flex flex-wrap items-center gap-3">
                <ChoiceSelect
                  label={t('dans.exam')}
                  value={row.type}
                  onValueChange={(v) =>
                    setExams(
                      exams.map((r, j) =>
                        j === i
                          ? {
                              ...r,
                              type: v as DanExam['type'],
                              perSong: v === 'gauge' ? false : r.perSong,
                              values: v === 'gauge' ? [r.values[0] ?? ['', '']] : r.values,
                            }
                          : r,
                      ),
                    )
                  }
                  items={examTypes.map((type) => ({
                    value: type,
                    label: t(`dans.examTypes.${type}`),
                  }))}
                />
                <ChoiceSelect
                  label={t('dans.range')}
                  value={row.range}
                  onValueChange={(v) =>
                    setExams(
                      exams.map((r, j) => (j === i ? { ...r, range: v as 'more' | 'less' } : r)),
                    )
                  }
                  items={(['more', 'less'] as const).map((range) => ({
                    value: range,
                    label: t(`dans.ranges.${range}`),
                  }))}
                />
                {row.type !== 'gauge' && (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={row.perSong}
                      onCheckedChange={(v) =>
                        setExams(
                          exams.map((r, j) =>
                            j === i
                              ? {
                                  ...r,
                                  perSong: Boolean(v),
                                  values: v
                                    ? Array.from({ length: songs.length }, () => [
                                        ...(r.values[0] ?? ['', '']),
                                      ])
                                    : [r.values[0] ?? ['', '']],
                                }
                              : r,
                          ),
                        )
                      }
                    />
                    {t('dans.perSong')}
                  </label>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto"
                  aria-label={t('dans.removeExam')}
                  onClick={() => setExams(exams.filter((_, j) => j !== i))}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {row.values.map((value, k) => (
                  <div key={k} className="flex items-center gap-2">
                    {row.perSong && (
                      <span className="w-12 shrink-0 text-xs text-muted-foreground">
                        {t('dans.songNumber', { number: k + 1 })}
                      </span>
                    )}
                    <Input
                      inputMode="numeric"
                      aria-label={t('dans.red')}
                      placeholder={t('dans.red')}
                      value={value[0]}
                      onChange={(e) =>
                        setExams(
                          exams.map((r, j) =>
                            j === i
                              ? {
                                  ...r,
                                  values: r.values.map((v, m) =>
                                    m === k ? [e.target.value, v[1]] : v,
                                  ),
                                }
                              : r,
                          ),
                        )
                      }
                    />
                    <Input
                      inputMode="numeric"
                      aria-label={t('dans.gold')}
                      placeholder={t('dans.gold')}
                      value={value[1]}
                      onChange={(e) =>
                        setExams(
                          exams.map((r, j) =>
                            j === i
                              ? {
                                  ...r,
                                  values: r.values.map((v, m) =>
                                    m === k ? [v[0], e.target.value] : v,
                                  ),
                                }
                              : r,
                          ),
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
          {exams.length < 4 && (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setExams([
                  ...exams,
                  { type: 'good', range: 'more', perSong: false, values: [['', '']] },
                ])
              }
            >
              <PlusIcon aria-hidden="true" />
              {t('dans.addExam')}
            </Button>
          )}
        </CardContent>
      </Card>
      <Card className="rounded-[14px]">
        <CardHeader>
          <CardTitle>{t('dans.rewards')}</CardTitle>
          <CardDescription>{t('dans.rewardsExplained')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ChoiceSelect
            label={t('dans.rewardDanLabel')}
            value={rewardDan}
            onValueChange={setRewardDan}
            items={[
              { value: 'none', label: t('dans.noDan') },
              ...danNames.map((name, i) => ({ value: String(i), label: name })).slice(danFirst),
            ]}
          />
          {rewardTitles.map((reward, i) => {
            const title = profile.titles?.find((p) => p.id === reward.id)
            return (
              <div key={i} className="flex flex-wrap items-center gap-3">
                {profile.titles ? (
                  <ChoiceSelect
                    label={t('dans.rewardTitleLabel')}
                    value={reward.id}
                    onValueChange={(v) =>
                      setRewardTitles(rewardTitles.map((r, j) => (j === i ? { ...r, id: v } : r)))
                    }
                    items={titleItems(reward.id)}
                  />
                ) : (
                  <Input
                    className="w-64 font-mono"
                    aria-label={t('dans.titleId')}
                    placeholder="taiko-master"
                    value={reward.id}
                    onChange={(e) =>
                      setRewardTitles(
                        rewardTitles.map((r, j) =>
                          j === i ? { ...r, id: e.target.value.trim() } : r,
                        ),
                      )
                    }
                  />
                )}
                <ChoiceSelect
                  label={t('dans.rewardLevel')}
                  value={reward.on}
                  onValueChange={(v) =>
                    setRewardTitles(
                      rewardTitles.map((r, j) =>
                        j === i ? { ...r, on: v as DanRewardTitle['on'] } : r,
                      ),
                    )
                  }
                  items={rewardLevels.map((level) => ({
                    value: level,
                    label: t(`dans.levels.${level}`),
                  }))}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('dans.removeReward')}
                  onClick={() => setRewardTitles(rewardTitles.filter((_, j) => j !== i))}
                >
                  <XIcon aria-hidden="true" />
                </Button>
                {title && <TitleBand title={title} language={i18n.resolvedLanguage} />}
                {title?.official && !official && (
                  <span className="text-xs text-muted-foreground">
                    {t('dans.officialTitleLater')}
                  </span>
                )}
                {title && !titleUsableBy(title, owner) && (
                  <span className="text-xs text-destructive">{t('dans.titleNotUsable')}</span>
                )}
                {profile.titles && reward.id && !title && (
                  <span className="text-xs text-destructive">{t('dans.titleMissing')}</span>
                )}
              </div>
            )
          })}
          {profile.failed && <Notice>{t('dans.titlesUnavailable')}</Notice>}
          <div className="flex flex-wrap items-center gap-3">
            {rewardTitles.length < 10 && (
              <Button
                type="button"
                variant="outline"
                disabled={!!profile.titles && usable.length === 0}
                onClick={() =>
                  setRewardTitles([...rewardTitles, { id: usable[0]?.id ?? '', on: 'red' }])
                }
              >
                <PlusIcon aria-hidden="true" />
                {t('dans.addReward')}
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={profile.reload}>
              <ArrowClockwiseIcon aria-hidden="true" />
              {t('dans.reloadTitles')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {profile.titles && usable.length === 0 && `${t('dans.noUsableTitles')} `}
            <a
              href={profileTitlesPage}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {t('dans.titleCatalog')}
            </a>
          </p>
        </CardContent>
      </Card>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || songs.length === 0}>
          {t('dans.save')}
        </Button>
        <Link className={buttonVariants({ variant: 'ghost' })} to={id ? `/dans/${id}` : '/dans'}>
          {t('dans.cancel')}
        </Link>
      </div>
      {picking !== null && (
        <SongPicker
          onDismiss={() => setPicking(null)}
          onPick={(chart) => {
            const blocks = slotBlocks(chart)
            if (blocks.length === 0) {
              setError(t('dans.noPlayableCourse'))
              setPicking(null)
              return
            }
            const text = chartText(chart, i18n.resolvedLanguage)
            // No block is chosen for the maker: the course names the one it plays.
            setSongCount([
              ...songs,
              {
                chartId: String(chart.id),
                title: text.title,
                blocks,
                course: '',
                side: '',
                hidden: false,
              },
            ])
            setPicking(null)
          }}
        />
      )}
    </form>
  )
}
