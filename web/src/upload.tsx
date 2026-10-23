import { isChartOwner } from './chart-owners'
import { chartText } from '@/chart-language'
import { i18n } from '@/i18n'
import { useTranslation } from 'react-i18next'
import { endpoints } from '@/api/endpoints'
import { DialogClose } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { AudioPlayer } from '@/components/audio-player'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowRightIcon as ArrowRight,
  WaveformIcon as AudioLines,
  FileAudioIcon as FileMusic,
  CheckIcon as Check,
  CircleNotchIcon as LoaderCircle,
  UploadSimpleIcon as Upload,
  WarningIcon,
} from '@phosphor-icons/react'
import { CoverPicker } from '@/components/cover-picker'
import { MoviePicker } from '@/components/movie-picker'
import { CategoryPicker } from './categories'
import { api, uploadChart } from './api/client'
import type { Chart } from './api/types'
import { Modal, Notice } from './notifications'
import { useNotification } from './notification-context'
import { courseNames, slotKey } from './courses'
import { DifficultyBadges } from '@/components/difficulty-badges'
import { useSession } from './session-context'
import { isAudioFilename, isMovieFilename, prepareTja, validateFiles, validateMovie } from './tja'
import type { PreparedTja } from './tja'

function createRequestKey() {
  // getRandomValues remains available over LAN HTTP, unlike randomUUID.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function UpdatePage() {
  const { t } = useTranslation()

  const { id } = useParams()
  const session = useSession()
  const [chart, setChart] = useState<Chart | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setChart(null)
    setError('')
    if (!id) return
    api<Chart>(endpoints.chart(id), { signal: controller.signal })
      .then((loaded) => {
        if (!controller.signal.aborted) setChart(loaded)
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [id])
  if (!id) return <Notice>{t('messages.missingSongId')}</Notice>
  if (error) return <Notice>{error}</Notice>
  if (!chart || session.loading) return <p role="status">{t('messages.loadingSong')}</p>
  if (!session.user || (!isChartOwner(chart, session.user.id) && !session.user.isAdmin))
    return <p>{t('messages.onlyTheUploaderOrAnAdministratorCanUpdateThisSong')}</p>
  return (
    <UploadPage
      key={`${chart.id}:${chart.difficulties.map((d) => d.chartHash ?? '').join(',')}:${chart.audioHash}`}
      existing={chart}
    />
  )
}

export function UploadPage({ existing }: { existing?: Chart }) {
  const { t } = useTranslation()

  const { notify } = useNotification()
  const session = useSession(),
    navigate = useNavigate()
  const [tja, setTja] = useState<File | null>(null),
    [audio, setAudio] = useState<File | null>(null)
  const [cover, setCover] = useState<File | null>(null)
  const [movie, setMovie] = useState<File | null>(null)
  const [metadata, setMetadata] = useState<PreparedTja | null>(null),
    [validating, setValidating] = useState(false),
    [validationError, setValidationError] = useState('')
  const [categoryIds, setCategoryIds] = useState<string[]>(existing?.categoryIds ?? [])
  const [description, setDescription] = useState(existing?.description ?? ''),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [audioUrl, setAudioUrl] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [tab, setTab] = useState('files')
  const [demoStart, setDemoStart] = useState('0')
  const [demoEnd, setDemoEnd] = useState('15')
  const [audioDuration, setAudioDuration] = useState<number | null>(null)
  const retainedAudioName = existing?.audioName
  const hasStoredMovie = !!existing?.movieHash
  const requestKey = useRef(createRequestKey()),
    controller = useRef<AbortController | null>(null)
  const reset = () => {
    setMetadata(null)
    setValidationError('')
    requestKey.current = createRequestKey()
  }
  useEffect(() => {
    let active = true
    setMetadata(null)
    setValidationError('')
    if (!tja || (!audio && !retainedAudioName)) {
      setValidating(false)
      return
    }
    setValidating(true)
    const validation = audio ? validateFiles(tja, audio) : prepareTja(tja, retainedAudioName!)
    validation
      .then((m) => {
        validateMovie(m, movie, hasStoredMovie)
        if (active) {
          setMetadata(m)
          setDemoStart(String(m.demoStart))
          setDemoEnd(String(m.demoStart + 15))
        }
      })
      .catch((e) => {
        if (active) setValidationError(e.message)
      })
      .finally(() => {
        if (active) setValidating(false)
      })
    return () => {
      active = false
    }
  }, [tja, audio, movie, retainedAudioName, hasStoredMovie])
  useEffect(() => {
    if (!audio) {
      setAudioUrl('')
      return
    }
    const url = URL.createObjectURL(audio)
    setAudioUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [audio])
  useEffect(() => {
    setAudioDuration(null)
    if (!audioUrl) return
    const player = new Audio(audioUrl)
    player.preload = 'metadata'
    player.onloadedmetadata = () => {
      if (Number.isFinite(player.duration)) setAudioDuration(player.duration)
    }
    return () => {
      player.onloadedmetadata = null
      player.removeAttribute('src')
      player.load()
    }
  }, [audioUrl])
  useEffect(() => () => controller.current?.abort(), [])
  const validPreview = () => {
    const start = Number(demoStart),
      end = Number(demoEnd)
    const duration = audio ? audioDuration : existing?.duration
    if (
      !demoStart.trim() ||
      !demoEnd.trim() ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      (duration != null && start >= duration) ||
      end <= start ||
      end > 1215
    ) {
      setTab('preview')
      notify(t('messages.previewRangeInvalid'), 'error')
      return false
    }
    return true
  }
  const choose = (kind: 'tja' | 'audio', e: ChangeEvent<HTMLInputElement>) => {
    reset()
    const file = e.target.files?.[0] ?? null
    if (kind === 'tja') setTja(file)
    else setAudio(file)
  }
  const drop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (busy) return
    const files = Array.from(e.dataTransfer.files),
      charts = files.filter((f) => /\.tja$/i.test(f.name)),
      tracks = files.filter((f) => isAudioFilename(f.name)),
      movies = files.filter((f) => isMovieFilename(f.name))
    reset()
    if (
      charts.length > 1 ||
      tracks.length > 1 ||
      movies.length > 1 ||
      charts.length + tracks.length + movies.length !== files.length
    ) {
      notify(t('messages.dropOneTjaAndOneOggOrMp3NoAdditionalFiles'), 'error')
      return
    }
    if (charts[0]) setTja(charts[0])
    if (tracks[0]) setAudio(tracks[0])
    if (movies[0]) setMovie(movies[0])
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!metadata || busy || !validPreview()) return
    if (existing) setConfirming(true)
    else void save()
  }
  const save = async () => {
    if (!tja || (!audio && !existing) || !metadata || busy || !validPreview()) return
    setConfirming(false)
    setBusy(true)
    setProgress(0)
    const abort = new AbortController()
    controller.current = abort
    try {
      const prepared = audio
        ? await validateFiles(tja, audio)
        : await prepareTja(tja, existing!.audioName)
      validateMovie(prepared, movie, hasStoredMovie)
      if (abort.signal.aborted) return
      const form = new FormData()
      form.append('tja', prepared.file)
      if (audio) form.append('audio', audio)
      if (movie) form.append('movie', movie)
      if (cover) form.append('cover', cover)
      if (existing) {
        form.append('confirmReset', 'true')
      }
      form.append('encoding', 'utf-8')
      form.append('description', description)
      form.append('demoStart', demoStart)
      form.append('demoEnd', demoEnd)
      form.append('categoryIds', JSON.stringify(categoryIds))
      form.append(
        'difficultyMakers',
        JSON.stringify(
          metadata.difficulties.map(({ course, side, maker }) => ({ course, side, maker })),
        ),
      )
      const chart = await uploadChart(
        form,
        session.csrfToken,
        requestKey.current,
        abort.signal,
        setProgress,
        existing?.id,
      )
      if ('status' in chart) {
        navigate('/me/charts')
        notify(t('messages.uploadAcceptedResultByNotification'), 'success')
        return
      }
      navigate(`/charts/${chart.id}`)
      notify(
        existing
          ? t('messages.songUpdatedAllPreviousChartsAndScoresHaveBeenDeleted')
          : t('messages.chartPublished'),
        'success',
      )
    } catch (e) {
      if (!abort.signal.aborted) notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
      controller.current = null
    }
  }
  const fileTile = (kind: 'tja' | 'audio') => {
    const file = kind === 'tja' ? tja : audio
    return (
      <Label className="flex min-w-0 flex-col items-start gap-3 rounded-2xl border p-4 [&>span]:w-full [&_small]:mt-1 [&_small]:block [&_small]:truncate [&_small]:text-muted-foreground">
        {kind === 'tja' ? <FileMusic size={24} /> : <AudioLines size={24} />}
        <span>
          <b>{kind === 'tja' ? t('messages.tjaChart') : t('messages.oggMp3Audio')}</b>
          <small>
            {file
              ? file.name
              : kind === 'tja'
                ? t('messages.tjaUpTo2Mib')
                : existing
                  ? t('messages.keepAudio', { filename: existing.audioName })
                  : t('messages.oggMp3UpTo100Mib')}
          </small>
        </span>
        {file ? (
          <Check size={18} />
        ) : (
          <span className="text-xs text-muted-foreground">{t('messages.choose')}</span>
        )}
        <Input
          type="file"
          aria-label={
            kind === 'tja' ? t('messages.chooseTjaChart') : t('messages.chooseOggOrMp3Audio')
          }
          accept={kind === 'tja' ? '.tja' : '.ogg,.mp3'}
          disabled={busy}
          onChange={(e) => choose(kind, e)}
        />
      </Label>
    )
  }

  return (
    <>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center [&_p]:mt-2 [&_p]:text-sm [&_p]:text-muted-foreground">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {existing ? t('messages.updateSongAndCharts') : t('messages.publishYourChart')}
          </h1>
          {existing && (
            <p>
              {t('messages.replaceSongHint', {
                title: chartText(existing, i18n.resolvedLanguage).title,
              })}
            </p>
          )}
          <div
            role="note"
            className="mt-3 flex items-start gap-2 rounded-2xl bg-yellow-100 px-4 py-3 text-sm font-medium text-yellow-800 dark:bg-[#393a21] dark:text-[#d7d887]"
          >
            <WarningIcon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{t('messages.doNotSubmitOfficialBandaiNamcoChartsOrAudio')}</span>
          </div>
        </div>
      </div>
      {!session.loading && !session.user && (
        <Notice kind="info" title={t('messages.signInToPublish')}>
          {t('messages.youCanCheckYourFilesFirstSignInOrRegisterAtThe')}
        </Notice>
      )}
      {existing && (
        <Card
          className="min-w-0 border p-5 shadow-none ring-0 sm:p-6 gap-3 border-destructive/30 [&>h2]:text-destructive [&>p]:text-sm [&>p]:leading-relaxed"
          aria-label={t('messages.beforeUpdating')}
        >
          <h2 className="text-base font-semibold">
            {t('messages.updatingDeletesAllPreviousScores')}
          </h2>
          <p>{t('messages.theNewTjaReplacesEveryChartInThisSongAllPlayersScores')}</p>
          <p>{t('messages.theSongUrlStaysTheSameTitlesComeFromTheNewTja')}</p>
        </Card>
      )}
      <form
        onSubmit={submit}
        noValidate
        className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] [&>div]:space-y-6 [&>aside]:space-y-3"
      >
        <div className="min-w-0">
          <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
            <TabsList
              aria-label={t('messages.publishYourChart')}
              className="grid h-auto! w-full grid-cols-3 rounded-2xl sm:grid-cols-5"
            >
              {(['files', 'categories', 'preview', 'description', 'makers'] as const).map(
                (value) => (
                  <TabsTrigger key={value} value={value} disabled={busy} className="h-auto py-2">
                    {t(
                      value === 'files'
                        ? 'messages.uploadFilesTab'
                        : `messages.metadataTab_${value}`,
                    )}
                  </TabsTrigger>
                ),
              )}
            </TabsList>
            <TabsContent value="files" className="space-y-6 pt-4">
              <Card className="min-w-0 border p-5 shadow-none ring-0 sm:p-6 gap-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-semibold">{t('messages.chooseFiles')}</h2>
                  <span className="text-sm text-muted-foreground">
                    {existing
                      ? t('messages.newTjaRequiredCurrentAudioCanBeKept')
                      : t('messages.bothFilesAreRequired')}
                  </span>
                </div>
                <div
                  className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground [&>strong]:text-foreground"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={drop}
                >
                  <Upload size={26} />
                  <strong>{t('messages.dropChartAndAudioHere')}</strong>
                  <span>{t('messages.orChooseFilesBelow')}</span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {fileTile('tja')}
                  {fileTile('audio')}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex min-w-0 flex-col gap-3 rounded-2xl border p-4">
                    <h3 className="text-sm font-bold">{t('messages.songCover')}</h3>
                    {existing && (
                      <p className="text-sm leading-6 text-muted-foreground">
                        {t('messages.keepCoverUnlessSelected')}
                      </p>
                    )}
                    <CoverPicker
                      file={cover}
                      disabled={busy}
                      onChange={(file) => {
                        setCover(file)
                        requestKey.current = createRequestKey()
                      }}
                    />
                  </div>
                  <div className="flex min-w-0 flex-col gap-3 rounded-2xl border p-4">
                    <h3 className="text-sm font-bold">{t('messages.backgroundMovie')}</h3>
                    <MoviePicker
                      file={movie}
                      disabled={busy}
                      hint={hasStoredMovie ? t('messages.keepMovie') : t('messages.movieUpTo64Mib')}
                      onChange={(file) => {
                        reset()
                        setMovie(file)
                      }}
                    />
                  </div>
                </div>
                {existing && audio && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="default"
                    disabled={busy}
                    onClick={() => {
                      reset()
                      setAudio(null)
                    }}
                  >
                    {t('messages.currentAudio', { filename: existing.audioName })}
                  </Button>
                )}
                {validationError && (
                  <Notice title={t('messages.fileValidationFailed')}>{validationError}</Notice>
                )}
                {metadata && (
                  <Notice kind="success" title={t('messages.localValidationPassed')}>
                    {t('messages.encodingDetected', {
                      encoding: metadata.sourceEncoding,
                      filename: metadata.wave,
                    })}
                  </Notice>
                )}
              </Card>
            </TabsContent>
            <TabsContent value="categories" className="pt-4">
              <Card className="min-w-0 border p-5 shadow-none ring-0 sm:p-6 gap-4">
                <CategoryPicker
                  value={categoryIds}
                  disabled={busy}
                  onChange={(ids) => {
                    setCategoryIds(ids)
                    requestKey.current = createRequestKey()
                  }}
                />
              </Card>
            </TabsContent>
            <TabsContent value="preview" className="pt-4">
              <Card className="min-w-0 gap-4 border p-5 shadow-none ring-0 sm:p-6">
                {metadata ? (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Label
                        htmlFor="upload-demo-start"
                        className="flex flex-col items-start gap-2"
                      >
                        {t('messages.previewStartSeconds')}
                        <Input
                          id="upload-demo-start"
                          type="number"
                          min="0"
                          step="any"
                          value={demoStart}
                          disabled={busy}
                          onChange={(e) => {
                            setDemoStart(e.target.value)
                            requestKey.current = createRequestKey()
                          }}
                        />
                      </Label>
                      <Label htmlFor="upload-demo-end" className="flex flex-col items-start gap-2">
                        {t('messages.previewEndSeconds')}
                        <Input
                          id="upload-demo-end"
                          type="number"
                          min="0"
                          max="1215"
                          step="any"
                          value={demoEnd}
                          disabled={busy}
                          onChange={(e) => {
                            setDemoEnd(e.target.value)
                            requestKey.current = createRequestKey()
                          }}
                        />
                      </Label>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t('messages.uploadPreviewHint')}
                    </p>
                    {(audioUrl || existing) && (
                      <AudioPlayer
                        label={t('messages.localAudioPreview')}
                        src={audioUrl || endpoints.resource(existing!, 'audio')}
                        startAt={demoStart.trim() ? Number(demoStart) : NaN}
                        endAt={demoEnd.trim() ? Number(demoEnd) : NaN}
                        disabled={busy || Number(demoEnd) > 1215}
                      />
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t('messages.chartInformationAppearsHereAfterValidation')}
                  </p>
                )}
              </Card>
            </TabsContent>
            <TabsContent value="makers" className="pt-4">
              {metadata ? (
                <Card className="min-w-0 border p-5 shadow-none ring-0 sm:p-6 gap-4">
                  <h2 className="text-base font-semibold">
                    {t('messages.difficultiesAndCreators')}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {metadata.maker
                      ? t('messages.creatorNamesAreFilledFromMakerYouCanEditEachOne')
                      : t('messages.noMakerWasSpecifiedEnterACreatorForEachDifficulty')}
                  </p>
                  <Table className="w-full">
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">{t('messages.difficulty')}</TableHead>
                        <TableHead scope="col">{t('messages.creator')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {metadata.difficulties.map((d) => (
                        <TableRow key={slotKey(d)}>
                          <TableHead scope="row">
                            {courseNames[slotKey(d) as keyof typeof courseNames]} · {slotKey(d)} ★
                            {d.level}
                          </TableHead>
                          <TableCell>
                            <Input
                              aria-label={t('messages.courseCreator', { difficulty: slotKey(d) })}
                              value={d.maker}
                              maxLength={500}
                              placeholder={t('messages.notSpecified')}
                              disabled={busy}
                              onChange={(e) => {
                                const maker = e.target.value
                                setMetadata(
                                  (current) =>
                                    current && {
                                      ...current,
                                      difficulties: current.difficulties.map((block) =>
                                        slotKey(block) === slotKey(d) ? { ...block, maker } : block,
                                      ),
                                    },
                                )
                                requestKey.current = createRequestKey()
                              }}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t('messages.chartInformationAppearsHereAfterValidation')}
                </p>
              )}
            </TabsContent>
            <TabsContent value="description" className="pt-4">
              <Card className="min-w-0 border p-5 shadow-none ring-0 sm:p-6 gap-4">
                <h2 className="text-base font-semibold">
                  {t('messages.addADescription')}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {t('messages.optional2')}
                  </span>
                </h2>
                <Label className="sr-only" htmlFor="description">
                  {t('messages.submissionDescription')}
                </Label>
                <Textarea
                  id="description"
                  rows={5}
                  maxLength={1000}
                  placeholder={t('messages.describeThisChartOrLeaveAMessage')}
                  value={description}
                  disabled={busy}
                  onChange={(e) => {
                    setDescription(e.target.value)
                    requestKey.current = createRequestKey()
                  }}
                />
                <span className="text-right text-xs text-muted-foreground">
                  {description.length} / 1000
                </span>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
        <aside>
          <Card
            data-testid="preview-panel"
            className="min-w-0 border p-5 shadow-none ring-0 sm:p-6 gap-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold">
                {existing ? t('messages.updatePreview') : t('messages.submissionPreview')}
              </h2>
            </div>
            {metadata ? (
              <>
                <p className="text-sm text-muted-foreground">{metadata.bpm} BPM</p>
                <h3 className="text-base font-medium">
                  {chartText(metadata, i18n.resolvedLanguage).title}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {chartText(metadata, i18n.resolvedLanguage).subtitle || t('messages.taikoChart')}
                </p>
                <DifficultyBadges difficulties={metadata.difficulties} />
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm [&>dt]:text-muted-foreground [&>dd]:wrap-anywhere mt-4">
                  <dt>{t('messages.chartCreator')}</dt>
                  <dd>
                    {[
                      ...new Set(metadata.difficulties.map((d) => d.maker.trim()).filter(Boolean)),
                    ].join(' | ') || t('messages.notSpecified')}
                  </dd>
                  <dt>{t('messages.uploader')}</dt>
                  <dd>{session.user?.nickname || t('messages.notSignedIn')}</dd>
                </dl>
              </>
            ) : (
              <div className="flex min-h-32 items-center justify-center text-center text-sm text-muted-foreground">
                <p>{t('messages.chartInformationAppearsHereAfterValidation')}</p>
              </div>
            )}
            <div className="space-y-3 border-t pt-4 [&>p]:text-xs [&>p]:leading-relaxed [&>p]:text-muted-foreground">
              <Button
                type="submit"
                variant="default"
                size="default"
                className="w-full"
                disabled={!metadata || validating || busy || !session.user}
              >
                {busy ? <LoaderCircle className="animate-spin" size={18} /> : <Upload size={18} />}{' '}
                {busy
                  ? t('messages.saving')
                  : validating
                    ? t('messages.validating')
                    : existing
                      ? t('messages.updateSongAndCharts')
                      : t('messages.publishChart')}
                {!busy && <ArrowRight size={17} />}
              </Button>
              {busy && (
                <Modal
                  title={existing ? t('messages.updatingSong') : t('messages.publishingChart')}
                  busy
                  onDismiss={() => {}}
                  actions={
                    <Button
                      type="button"
                      variant="outline"
                      size="default"
                      onClick={() => controller.current?.abort()}
                    >
                      {t('messages.cancelUpload')}
                    </Button>
                  }
                >
                  <div className="space-y-3" role="status">
                    <Progress
                      aria-label={t('messages.uploadProgress')}
                      max={100}
                      value={progress}
                    />
                    <span>
                      {progress < 100
                        ? t('messages.uploadProgressPercent', { progress: progress })
                        : t('messages.uploadedValidatingAndSaving')}
                    </span>
                  </div>
                </Modal>
              )}
              <p>
                {existing
                  ? t('messages.afterUpdatingScoresForEveryDifficultyStartOver')
                  : t('messages.oncePublishedOthersCanBrowseListenToAndDownloadYourChart')}
              </p>
            </div>
          </Card>
          <Button
            type="button"
            variant="ghost"
            size="default"
            className="w-full"
            onClick={() =>
              notify(
                t('messages.waveInTheTjaMustExactlyMatchTheAudioFilenameIncludingCase'),
                'info',
                t('messages.uploadRules'),
              )
            }
          >
            {t('messages.viewUploadRules')}
          </Button>
        </aside>
      </form>
      {confirming && existing && (
        <Modal
          title={t('messages.replaceSongAndDeleteAllPreviousScores')}
          alert
          onDismiss={() => setConfirming(false)}
          actions={
            <>
              <DialogClose render={<Button type="button" variant="outline" size="default" />}>
                {t('messages.cancel')}
              </DialogClose>
              <Button type="button" variant="default" size="default" onClick={() => void save()}>
                {t('messages.replaceAndDelete')}
              </Button>
            </>
          }
        >
          <p>
            {t('upload.replacement', {
              previous: chartText(existing, i18n.resolvedLanguage).title,
              title: metadata ? chartText(metadata, i18n.resolvedLanguage).title : '',
              count: metadata?.difficulties.length ?? 0,
            })}
          </p>
          <p>{t('messages.allPlayersPreviousScoresChartsAndFilesForThisSongWillBe')}</p>
        </Modal>
      )}
    </>
  )
}
