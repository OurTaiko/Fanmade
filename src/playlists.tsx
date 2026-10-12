import { useCallback, useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CheckIcon,
  HeartIcon,
  LockSimpleIcon,
  MusicNotesIcon,
  PlaylistIcon,
  PlusIcon,
  SortDescendingIcon,
  XIcon,
} from '@phosphor-icons/react'
import { api, jsonRequest } from '@/api/client'
import { endpoints } from '@/api/endpoints'
import type { Chart, MyPlaylists, Playlist, PlaylistPage as PlaylistList } from '@/api/types'
import { CategoryLabels, CategorySelect } from '@/categories'
import { chartText } from '@/chart-language'
import { ChartCard } from '@/components/chart-card'
import { ChoiceSelect } from '@/components/choice-select'
import { CoverPicker } from '@/components/cover-picker'
import { SearchInput } from '@/components/search-input'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogClose } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { UserAvatar } from '@/components/user-avatar'
import { cn } from '@/lib/utils'
import { Modal, Notice } from '@/notifications'
import { useNotification } from '@/notification-context'
import { useSession } from '@/session-context'

const systemIds = ['liked', 'popular', 'acclaimed', 'daily'] as const
const sorts = ['updated', 'newest', 'favorites'] as const
type Sort = (typeof sorts)[number]

const emptyStateClassName =
  'flex flex-col items-center justify-center gap-4 rounded-3xl border border-dashed bg-card/60 px-6 py-16 text-center [&>p]:max-w-lg [&>p]:text-muted-foreground'
const panelClassName = 'rounded-2xl bg-white p-6 shadow-[0_4px_12px_rgba(0,0,0,0.08)] dark:bg-card'

// The server names system playlists in English; show them in the page language.
function usePlaylistText() {
  const { t } = useTranslation()
  return (playlist: Pick<Playlist, 'id' | 'name' | 'description' | 'system'>) => {
    const id = systemIds.find((value) => playlist.system && value === playlist.id)
    return id
      ? {
          name: t(`playlists.system.${id}.name`),
          description: t(`playlists.system.${id}.description`),
        }
      : { name: playlist.name, description: playlist.description }
  }
}

const coverSource = (playlist: Pick<Playlist, 'id' | 'coverHash'>) =>
  playlist.coverHash ? endpoints.playlistCover(playlist.id, playlist.coverHash) : undefined

function PlaylistFacts({ playlist }: { playlist: Playlist }) {
  const { t } = useTranslation()
  return (
    <CategoryLabels ids={[playlist.categoryId]}>
      <li>
        <Badge variant="outline" className="tabular-nums">
          <MusicNotesIcon aria-hidden="true" />
          {t('playlists.songCount', { count: playlist.chartCount })}
        </Badge>
      </li>
      {playlist.system ? (
        <li>
          <Badge variant="secondary">{t('playlists.systemBadge')}</Badge>
        </li>
      ) : (
        <>
          <li>
            <Badge variant="outline" className="tabular-nums">
              <HeartIcon aria-hidden="true" />
              {t('playlists.favoriteCount', { count: playlist.favoriteCount })}
            </Badge>
          </li>
          {!playlist.public && (
            <li>
              <Badge variant="secondary">
                <LockSimpleIcon aria-hidden="true" />
                {t('playlists.private')}
              </Badge>
            </li>
          )}
        </>
      )}
    </CategoryLabels>
  )
}

function PlaylistCard({ playlist }: { playlist: Playlist }) {
  const { t } = useTranslation()
  const text = usePlaylistText()(playlist)
  const [failedSource, setFailedSource] = useState('')
  const source = coverSource(playlist)
  const hasCover = !!source && failedSource !== source
  return (
    <Link
      className="group block min-w-0 rounded-2xl outline-none transition-transform duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1)] focus-visible:ring-2 focus-visible:ring-[#0071e3] focus-visible:ring-offset-4 active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none"
      data-testid="playlist-card"
      to={`/playlists/${encodeURIComponent(playlist.id)}`}
    >
      <Card
        size="sm"
        className="relative isolate h-44 gap-3 rounded-2xl bg-white px-6 py-5 shadow-[0_4px_12px_rgba(0,0,0,0.08)] ring-0 dark:bg-card"
      >
        {hasCover && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
            <img
              src={source}
              alt=""
              loading="lazy"
              decoding="async"
              className="size-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1)] group-hover:scale-105 motion-reduce:transform-none motion-reduce:transition-none"
              onError={() => setFailedSource(source)}
            />
            <div className="absolute inset-0 bg-white/60 dark:bg-black/60" />
          </div>
        )}
        <div
          className={cn(
            'min-w-0 space-y-1',
            hasCover &&
              '[text-shadow:0_1px_3px_rgb(255_255_255/0.9)] dark:[text-shadow:0_1px_3px_rgb(0_0_0/0.9)]',
          )}
        >
          <h3 className="truncate text-lg font-semibold tracking-tight" title={text.name}>
            {text.name}
          </h3>
          <p
            className={cn(
              'line-clamp-2 min-h-10 text-sm',
              hasCover ? 'text-foreground/80' : 'text-muted-foreground',
            )}
          >
            {text.description}
          </p>
        </div>
        <div className="mt-auto space-y-3">
          {playlist.owner && (
            <p className="flex min-w-0 items-center gap-2 text-sm">
              <UserAvatar
                nickname={playlist.owner.nickname || t('messages.unknownMember')}
                avatarUrl={playlist.owner.avatarUrl}
                className="size-5 shrink-0"
                fallbackClassName="text-[10px]"
              />
              <span className="truncate">
                {playlist.owner.nickname || t('messages.unknownMember')}
              </span>
            </p>
          )}
          <div className="max-h-5 overflow-hidden">
            <PlaylistFacts playlist={playlist} />
          </div>
        </div>
      </Card>
    </Link>
  )
}

function PlaylistGrid({ items, empty }: { items: Playlist[]; empty: ReactNode }) {
  if (!items.length) return <div className={emptyStateClassName}>{empty}</div>
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((playlist) => (
        <PlaylistCard key={playlist.id} playlist={playlist} />
      ))}
    </div>
  )
}

function LoadingGrid() {
  const { t } = useTranslation()
  return (
    <div
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      role="status"
      aria-label={t('playlists.loading')}
    >
      {[0, 1, 2].map((n) => (
        <Skeleton className="h-44 rounded-2xl" key={n} />
      ))}
    </div>
  )
}

// Public playlists, optionally of one user, with search, order and paging kept
// in the address unless the list is embedded in another page.
function PublicPlaylists({ ownerId, refresh = 0 }: { ownerId?: string; refresh?: number }) {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const [local, setLocal] = useState({ q: '', sort: 'updated' as Sort, page: 1 })
  const requested = params.get('sort') as Sort
  const state = ownerId
    ? local
    : {
        q: params.get('q') || '',
        sort: sorts.includes(requested) ? requested : 'updated',
        page: Math.min(10000, Math.max(1, Math.floor(Number(params.get('page')) || 1))),
      }
  const { q, sort, page } = state
  const update = useCallback(
    (values: Partial<typeof local>) => {
      if (ownerId) return setLocal((current) => ({ ...current, page: 1, ...values }))
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          next.set('page', '1')
          for (const [key, value] of Object.entries(values)) {
            if (value) next.set(key, String(value))
            else next.delete(key)
          }
          return next
        },
        { replace: 'q' in values },
      )
    },
    [ownerId, setParams],
  )
  const search = useCallback((query: string) => update({ q: query }), [update])
  const [data, setData] = useState<PlaylistList | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [searchPending, setSearchPending] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    api<PlaylistList>(
      endpoints.playlistList({ q, sort, page, ...(ownerId ? { owner: ownerId } : {}) }),
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setData(result)
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [q, sort, page, ownerId, refresh])
  const busy = loading || searchPending
  return (
    <>
      <div
        role="search"
        aria-label={t('playlists.search')}
        className="flex flex-col gap-3 sm:flex-row sm:items-center"
      >
        <SearchInput
          value={q}
          onSearch={search}
          onPendingChange={setSearchPending}
          label={t('playlists.search')}
          placeholder={t('playlists.searchPlaceholder')}
        />
        <div className="shrink-0 [&_[data-slot=select-trigger]]:w-full sm:[&_[data-slot=select-trigger]]:w-auto">
          <ChoiceSelect
            label={t('playlists.sort')}
            value={sort}
            prefix={
              <SortDescendingIcon aria-hidden="true" className="size-4 text-muted-foreground" />
            }
            items={[
              { value: 'updated', label: t('playlists.sortUpdated') },
              { value: 'newest', label: t('playlists.sortNewest') },
              { value: 'favorites', label: t('playlists.sortFavorites') },
            ]}
            onValueChange={(value) => update({ sort: value as Sort })}
          />
        </div>
      </div>
      <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
        {busy
          ? t('playlists.loading')
          : error
            ? ''
            : t('playlists.total', { total: data?.total ?? 0 })}
      </p>
      {error ? (
        <Notice>{error}</Notice>
      ) : busy || !data ? (
        <LoadingGrid />
      ) : (
        <>
          <PlaylistGrid
            items={data.items}
            empty={
              <h2 className="text-base font-semibold">
                {q
                  ? t('playlists.emptySearch')
                  : ownerId
                    ? t('playlists.emptyUser')
                    : t('playlists.empty')}
              </h2>
            }
          />
          {data.total > data.pageSize && (
            <nav
              aria-label={t('playlists.pagination')}
              className="flex flex-wrap items-center justify-center gap-4 py-4 text-sm"
            >
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => update({ page: page - 1 })}
              >
                {t('messages.previous')}
              </Button>
              <span>
                {t('messages.pagination', { page, pages: Math.ceil(data.total / data.pageSize) })}
              </span>
              <Button
                variant="outline"
                disabled={page * data.pageSize >= data.total}
                onClick={() => update({ page: page + 1 })}
              >
                {t('messages.next')}
              </Button>
            </nav>
          )}
        </>
      )}
    </>
  )
}

export function UserPlaylists({ ownerId }: { ownerId: string }) {
  const { t } = useTranslation()
  return (
    <section className="min-w-0 space-y-6" aria-label={t('playlists.userPlaylists')}>
      <PublicPlaylists ownerId={ownerId} />
    </section>
  )
}

export function PlaylistsPage() {
  const { t } = useTranslation()
  const session = useSession()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [systems, setSystems] = useState<Playlist[]>([])
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])
  // The personal system playlist appears once the session is known.
  useEffect(() => {
    const controller = new AbortController()
    api<{ items: Playlist[] }>(endpoints.systemPlaylists, { signal: controller.signal })
      .then(({ items }) => setSystems(items))
      .catch(() => {})
    return () => controller.abort()
  }, [session.user?.id])
  return (
    <section className="space-y-8" aria-labelledby="playlists-heading">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
        <div className="space-y-3">
          <h1 id="playlists-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {t('playlists.plaza')}
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {t('playlists.plazaDescription')}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link className={buttonVariants({ variant: 'outline' })} to="/me/playlists">
            <PlaylistIcon aria-hidden="true" />
            {t('playlists.mine')}
          </Link>
          {session.user && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon aria-hidden="true" />
              {t('playlists.create')}
            </Button>
          )}
        </div>
      </div>
      {systems.length > 0 && (
        <section className="space-y-4" aria-labelledby="system-playlists-heading">
          <h2 id="system-playlists-heading" className="text-base font-semibold">
            {t('playlists.systemSection')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {systems.map((playlist) => (
              <PlaylistCard key={playlist.id} playlist={playlist} />
            ))}
          </div>
        </section>
      )}
      <PublicPlaylists />
      {creating && (
        <PlaylistDialog
          onDismiss={() => setCreating(false)}
          onSaved={(playlist) => navigate(`/playlists/${encodeURIComponent(playlist.id)}`)}
        />
      )}
    </section>
  )
}

export function MyPlaylistsPage() {
  const { t } = useTranslation()
  const session = useSession()
  const navigate = useNavigate()
  const [data, setData] = useState<MyPlaylists | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const userId = session.user?.id
  useEffect(() => {
    if (!userId) return
    const controller = new AbortController()
    setData(null)
    setError('')
    api<MyPlaylists>(endpoints.myPlaylists(), { signal: controller.signal })
      .then(setData)
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [userId])
  if (!session.user)
    return (
      <div className={emptyStateClassName}>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('playlists.mine')}</h1>
        <p>{session.loading ? t('messages.loadingAccount') : t('playlists.signInToManage')}</p>
        {!session.loading && (
          <Link className={buttonVariants()} to="/login">
            {t('messages.signIn')}
            <ArrowRightIcon size={16} aria-hidden="true" />
          </Link>
        )}
      </div>
    )
  return (
    <section className="space-y-8" aria-labelledby="my-playlists-heading">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
        <div className="space-y-3">
          <h1
            id="my-playlists-heading"
            className="text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            {t('playlists.mine')}
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {t('playlists.mineDescription')}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link className={buttonVariants({ variant: 'outline' })} to="/playlists">
            {t('playlists.plaza')}
          </Link>
          <Button
            disabled={!data || data.owned.length >= data.maxPlaylists}
            onClick={() => setCreating(true)}
          >
            <PlusIcon aria-hidden="true" />
            {t('playlists.create')}
          </Button>
        </div>
      </div>
      {error ? (
        <Notice>{error}</Notice>
      ) : !data ? (
        <LoadingGrid />
      ) : (
        <>
          <section className="space-y-4" aria-labelledby="owned-playlists-heading">
            <h2 id="owned-playlists-heading" className="text-base font-semibold">
              {t('playlists.owned')}{' '}
              <span className="text-muted-foreground">{data.owned.length}</span>
            </h2>
            <PlaylistGrid
              items={data.owned}
              empty={<h3 className="text-base font-semibold">{t('playlists.emptyOwned')}</h3>}
            />
          </section>
          <section className="space-y-4" aria-labelledby="favorite-playlists-heading">
            <h2 id="favorite-playlists-heading" className="text-base font-semibold">
              {t('playlists.favorites')}{' '}
              <span className="text-muted-foreground">{data.favorites.length}</span>
            </h2>
            <PlaylistGrid
              items={data.favorites}
              empty={<h3 className="text-base font-semibold">{t('playlists.emptyFavorites')}</h3>}
            />
          </section>
        </>
      )}
      {creating && (
        <PlaylistDialog
          onDismiss={() => setCreating(false)}
          onSaved={(playlist) => navigate(`/playlists/${encodeURIComponent(playlist.id)}`)}
        />
      )}
    </section>
  )
}

// Creates a playlist, or edits the one given.
function PlaylistDialog({
  playlist,
  onSaved,
  onDismiss,
}: {
  playlist?: Playlist
  onSaved: (playlist: Playlist) => void
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  const { csrfToken } = useSession()
  const id = useId()
  const [name, setName] = useState(playlist?.name ?? '')
  const [description, setDescription] = useState(playlist?.description ?? '')
  const [categoryId, setCategoryId] = useState(playlist?.categoryId ?? 'variety')
  const [isPublic, setIsPublic] = useState(playlist?.public ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const body = { name, description, categoryId, public: isPublic }
      const saved = await api<Playlist>(
        playlist ? endpoints.playlist(playlist.id) : endpoints.playlists,
        jsonRequest(playlist ? 'PATCH' : 'POST', body, csrfToken),
      )
      onSaved(saved)
      onDismiss()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <Modal
      title={playlist ? t('playlists.edit') : t('playlists.create')}
      busy={busy}
      onDismiss={onDismiss}
      actions={
        <>
          <DialogClose render={<Button type="button" variant="outline" />} disabled={busy}>
            {t('messages.cancel')}
          </DialogClose>
          <Button disabled={busy || !name.trim()} onClick={() => void save()}>
            {busy
              ? t('messages.saving')
              : playlist
                ? t('messages.saveChanges')
                : t('playlists.create')}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <Label htmlFor={`${id}-name`}>{t('playlists.name')}</Label>
        <Input
          id={`${id}-name`}
          value={name}
          maxLength={50}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-description`}>{t('playlists.description')}</Label>
        <Textarea
          id={`${id}-description`}
          value={description}
          maxLength={500}
          disabled={busy}
          placeholder={t('playlists.descriptionPlaceholder')}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">{t('playlists.category')}</p>
        <CategorySelect
          label={t('playlists.category')}
          value={categoryId}
          onChange={setCategoryId}
          disabled={busy}
        />
        <p className="text-muted-foreground">{t('playlists.categoryHelp')}</p>
      </div>
      <div className="space-y-2">
        <Label className="inline-flex items-center gap-2">
          <Checkbox
            checked={isPublic}
            disabled={busy}
            onCheckedChange={(checked) => setIsPublic(checked === true)}
          />
          <span>{t('playlists.public')}</span>
        </Label>
        <p className="text-muted-foreground">{t('playlists.publicHelp')}</p>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </Modal>
  )
}

function PlaylistCoverDialog({
  playlist,
  onSaved,
  onDismiss,
}: {
  playlist: Playlist
  onSaved: (coverHash: string) => void
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  const { csrfToken } = useSession()
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const send = async (remove: boolean) => {
    setBusy(true)
    setError('')
    try {
      const form = new FormData()
      if (file) form.append('cover', file)
      const result = await api<{ coverHash: string }>(endpoints.playlistCover(playlist.id), {
        method: remove ? 'DELETE' : 'PUT',
        headers: { 'X-CSRF-Token': csrfToken },
        ...(remove ? {} : { body: form }),
      })
      onSaved(result.coverHash)
      onDismiss()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <Modal
      title={t('playlists.changeCover')}
      busy={busy}
      onDismiss={onDismiss}
      actions={
        <>
          {playlist.coverHash && (
            <Button variant="outline" disabled={busy} onClick={() => void send(true)}>
              {t('playlists.removeCover')}
            </Button>
          )}
          <Button disabled={!file || busy} onClick={() => void send(false)}>
            {busy ? t('messages.saving') : t('messages.saveCover')}
          </Button>
        </>
      }
    >
      <CoverPicker
        file={file}
        onChange={(chosen) => {
          setFile(chosen)
          setError('')
        }}
        disabled={busy}
      />
      <p className="text-muted-foreground">{t('playlists.coverHelp')}</p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </Modal>
  )
}

export function PlaylistPage() {
  const { id = '' } = useParams()
  const { t, i18n } = useTranslation()
  const session = useSession()
  const navigate = useNavigate()
  const { notify } = useNotification()
  const playlistText = usePlaylistText()
  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<'' | 'edit' | 'cover' | 'delete'>('')
  const [arranging, setArranging] = useState(false)
  const [failedCover, setFailedCover] = useState('')
  const userId = session.user?.id
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [id])
  // A private playlist loads once the session is known, hence the user dependency.
  useEffect(() => {
    const controller = new AbortController()
    setPlaylist(null)
    setError('')
    setDialog('')
    setArranging(false)
    api<Playlist>(endpoints.playlist(id), { signal: controller.signal })
      .then(setPlaylist)
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [id, userId])
  const back = (
    <Link
      to="/playlists"
      className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-4 shrink-0" />
      {t('playlists.back')}
    </Link>
  )
  if (error)
    return (
      <section className="space-y-6">
        {back}
        <Card role="alert" className="rounded-2xl border p-6 text-destructive shadow-none ring-0">
          {error}
        </Card>
      </section>
    )
  if (!playlist)
    return (
      <section className="space-y-6" role="status" aria-label={t('playlists.loading')}>
        {back}
        <Skeleton className="h-56 rounded-2xl" />
        <LoadingGrid />
      </section>
    )
  const text = playlistText(playlist)
  const charts = playlist.charts ?? []
  const owned = !playlist.system && !!userId && playlist.ownerId === userId
  const source = coverSource(playlist)
  // Each change is sent at once; a failure restores what the server holds.
  const change = async (next: Chart[], request: () => Promise<unknown>) => {
    setBusy(true)
    setPlaylist({ ...playlist, charts: next, chartCount: next.length })
    try {
      await request()
    } catch (e) {
      notify((e as Error).message, 'error')
      setPlaylist(playlist)
    } finally {
      setBusy(false)
    }
  }
  const move = (index: number, offset: number) => {
    const next = [...charts]
    const [chart] = next.splice(index, 1)
    next.splice(index + offset, 0, chart)
    void change(next, () =>
      api(
        endpoints.playlistOrder(playlist.id),
        jsonRequest('PUT', { chartIds: next.map((item) => item.id) }, session.csrfToken),
      ),
    )
  }
  const removeSong = (chart: Chart) =>
    void change(
      charts.filter((item) => item.id !== chart.id),
      () =>
        api(endpoints.playlistItem(playlist.id, chart.id), {
          method: 'DELETE',
          headers: { 'X-CSRF-Token': session.csrfToken },
        }),
    )
  const toggleFavorite = async () => {
    setBusy(true)
    try {
      const result = await api<{ favorited: boolean; favoriteCount: number }>(
        endpoints.playlistFavorite(playlist.id),
        {
          method: playlist.favorited ? 'DELETE' : 'PUT',
          headers: { 'X-CSRF-Token': session.csrfToken },
        },
      )
      setPlaylist({ ...playlist, ...result })
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    setBusy(true)
    try {
      await api(endpoints.playlist(playlist.id), {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': session.csrfToken },
      })
      notify(t('playlists.deleted'), 'success')
      navigate(owned ? '/me/playlists' : '/playlists')
    } catch (e) {
      notify((e as Error).message, 'error')
      setBusy(false)
      setDialog('')
    }
  }
  return (
    <section className="space-y-6" aria-labelledby="playlist-heading">
      {back}
      <div className={cn(panelClassName, 'flex flex-col gap-6 sm:flex-row')}>
        <div className="flex aspect-square w-full shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#f5f5f7] sm:w-44 dark:bg-muted">
          {source && failedCover !== source ? (
            <img
              src={source}
              alt={t('playlists.coverAlt', { name: text.name })}
              className="size-full object-cover"
              onError={() => setFailedCover(source)}
            />
          ) : (
            <PlaylistIcon className="size-12 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="space-y-2">
            <h1
              id="playlist-heading"
              className="text-2xl font-semibold tracking-tight wrap-anywhere sm:text-4xl"
            >
              {text.name}
            </h1>
            {text.description && (
              <p className="max-w-3xl whitespace-pre-line text-sm leading-relaxed text-muted-foreground wrap-anywhere">
                {text.description}
              </p>
            )}
          </div>
          {playlist.owner && (
            <p className="flex min-w-0 items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t('playlists.creator')}</span>
              <Link
                to={`/users/${encodeURIComponent(playlist.owner.id)}`}
                className="flex min-w-0 items-center gap-2 font-medium hover:text-[#0071e3]"
              >
                <UserAvatar
                  nickname={playlist.owner.nickname || t('messages.unknownMember')}
                  avatarUrl={playlist.owner.avatarUrl}
                  className="size-6 shrink-0"
                  fallbackClassName="text-xs"
                />
                <span className="truncate">
                  {playlist.owner.nickname || t('messages.unknownMember')}
                </span>
              </Link>
            </p>
          )}
          <PlaylistFacts playlist={playlist} />
          <div className="mt-auto flex flex-wrap gap-3">
            {owned ? (
              <>
                <Button disabled={busy} onClick={() => setDialog('edit')}>
                  {t('playlists.edit')}
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setDialog('cover')}>
                  {t('playlists.changeCover')}
                </Button>
                {charts.length > 0 && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    aria-pressed={arranging}
                    onClick={() => setArranging(!arranging)}
                  >
                    {arranging ? t('playlists.done') : t('playlists.arrange')}
                  </Button>
                )}
              </>
            ) : (
              !playlist.system &&
              userId && (
                <Button
                  variant={playlist.favorited ? 'secondary' : 'default'}
                  disabled={busy}
                  aria-pressed={playlist.favorited}
                  onClick={() => void toggleFavorite()}
                >
                  <HeartIcon weight={playlist.favorited ? 'fill' : 'bold'} aria-hidden="true" />
                  {playlist.favorited ? t('playlists.unfavorite') : t('playlists.favorite')}
                </Button>
              )
            )}
            {!playlist.system && (owned || (session.user?.isAdmin && playlist.public)) && (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => setDialog('delete')}
              >
                {t('playlists.delete')}
              </Button>
            )}
          </div>
        </div>
      </div>
      {charts.length === 0 ? (
        <div className={emptyStateClassName}>
          <h2 className="text-base font-semibold">{t('playlists.emptySongs')}</h2>
          {owned && <p>{t('playlists.emptySongsOwner')}</p>}
          {owned && (
            <Link to="/" className={buttonVariants({ variant: 'outline' })}>
              {t('messages.exploreCharts')}
              <ArrowRightIcon size={16} aria-hidden="true" />
            </Link>
          )}
        </div>
      ) : arranging ? (
        <ol className={cn(panelClassName, 'divide-y py-2')}>
          {charts.map((chart, index) => {
            const title = chartText(chart, i18n.resolvedLanguage).title
            return (
              <li key={chart.id} className="flex min-h-14 items-center gap-3">
                <span className="w-8 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium" title={title}>
                  {title}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy || index === 0}
                  aria-label={t('playlists.moveUp', { title })}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUpIcon aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy || index === charts.length - 1}
                  aria-label={t('playlists.moveDown', { title })}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDownIcon aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive hover:text-destructive"
                  disabled={busy}
                  aria-label={t('playlists.removeSong', { title })}
                  onClick={() => removeSong(chart)}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </li>
            )
          })}
        </ol>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {charts.map((chart) => (
            <ChartCard key={chart.id} chart={chart} />
          ))}
        </div>
      )}
      {dialog === 'edit' && (
        <PlaylistDialog
          playlist={playlist}
          onDismiss={() => setDialog('')}
          onSaved={(saved) => setPlaylist({ ...saved, charts, chartCount: charts.length })}
        />
      )}
      {dialog === 'cover' && (
        <PlaylistCoverDialog
          playlist={playlist}
          onDismiss={() => setDialog('')}
          onSaved={(coverHash) => setPlaylist({ ...playlist, coverHash: coverHash || undefined })}
        />
      )}
      {dialog === 'delete' && (
        <Modal
          title={t('playlists.deleteTitle')}
          busy={busy}
          alert
          onDismiss={() => setDialog('')}
          actions={
            <>
              <DialogClose render={<Button type="button" variant="outline" />} disabled={busy}>
                {t('messages.cancel')}
              </DialogClose>
              <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
                {busy ? t('messages.deleting') : t('messages.confirmDeletion')}
              </Button>
            </>
          }
        >
          {t('playlists.deleteDescription')}
        </Modal>
      )}
    </section>
  )
}

// Lists the viewer's playlists; selecting one adds the song or takes it out.
export function AddToPlaylistDialog({ chart, onDismiss }: { chart: Chart; onDismiss: () => void }) {
  const { t } = useTranslation()
  const { csrfToken } = useSession()
  const id = useId()
  const [data, setData] = useState<MyPlaylists | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    api<MyPlaylists>(endpoints.myPlaylists(chart.id), { signal: controller.signal })
      .then(setData)
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [chart.id])
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const setContained = (playlistId: string, contained: boolean) =>
    setData(
      (current) =>
        current && {
          ...current,
          owned: current.owned.map((item) =>
            item.id === playlistId
              ? {
                  ...item,
                  containsChart: contained,
                  chartCount: item.chartCount + (contained ? 1 : -1),
                }
              : item,
          ),
        },
    )
  const toggle = (playlist: Playlist) =>
    run(async () => {
      await api(endpoints.playlistItem(playlist.id, chart.id), {
        method: playlist.containsChart ? 'DELETE' : 'PUT',
        headers: { 'X-CSRF-Token': csrfToken },
      })
      setContained(playlist.id, !playlist.containsChart)
    })
  const create = () =>
    run(async () => {
      const created = await api<Playlist>(
        endpoints.playlists,
        jsonRequest('POST', { name }, csrfToken),
      )
      setData(
        (current) =>
          current && {
            ...current,
            owned: [{ ...created, containsChart: false }, ...current.owned],
          },
      )
      setName('')
      await api(endpoints.playlistItem(created.id, chart.id), {
        method: 'PUT',
        headers: { 'X-CSRF-Token': csrfToken },
      })
      setContained(created.id, true)
    })
  return (
    <Modal title={t('playlists.addToPlaylist')} busy={busy} onDismiss={onDismiss}>
      <p className="text-muted-foreground">{t('playlists.addHelp')}</p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">{t('playlists.loading')}</p>}
      {data && (
        <>
          <div
            className="max-h-72 space-y-2 overflow-y-auto"
            role="group"
            aria-label={t('playlists.owned')}
          >
            {data.owned.length === 0 && (
              <p className="text-muted-foreground">{t('playlists.emptyOwned')}</p>
            )}
            {data.owned.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                disabled={busy || (!playlist.containsChart && playlist.chartCount >= data.maxItems)}
                aria-pressed={!!playlist.containsChart}
                onClick={() => void toggle(playlist)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border p-3 text-left active:scale-[0.98] disabled:opacity-50',
                  playlist.containsChart
                    ? 'border-primary bg-primary/5'
                    : 'border-transparent bg-muted/40',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{playlist.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t('playlists.songCount', { count: playlist.chartCount })}
                    {' · '}
                    {playlist.public ? t('playlists.public') : t('playlists.private')}
                  </span>
                </span>
                {playlist.containsChart && (
                  <span className="flex shrink-0 items-center gap-1 text-xs whitespace-nowrap text-primary">
                    <CheckIcon aria-hidden="true" />
                    {t('playlists.inPlaylist')}
                  </span>
                )}
              </button>
            ))}
          </div>
          {data.owned.length < data.maxPlaylists && (
            <div className="flex gap-2">
              <Input
                id={`${id}-name`}
                value={name}
                maxLength={50}
                disabled={busy}
                aria-label={t('playlists.newPlaylistName')}
                placeholder={t('playlists.newPlaylistName')}
                onChange={(event) => setName(event.target.value)}
              />
              <Button
                variant="outline"
                className="shrink-0"
                disabled={busy || !name.trim()}
                onClick={() => void create()}
              >
                <PlusIcon aria-hidden="true" />
                {t('playlists.createAndAdd')}
              </Button>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
