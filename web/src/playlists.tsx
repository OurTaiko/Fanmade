import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  HeartIcon,
  PlaylistIcon,
  PlusIcon,
  SortDescendingIcon,
  XIcon,
} from '@phosphor-icons/react'
import { api, jsonRequest } from '@/api/client'
import { endpoints } from '@/api/endpoints'
import type { Chart, MyPlaylists, Playlist, PlaylistPage as PlaylistList } from '@/api/types'
import { chartText } from '@/chart-language'
import { ChartCard } from '@/components/chart-card'
import { ChoiceSelect } from '@/components/choice-select'
import { SearchInput } from '@/components/search-input'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DialogClose } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/user-avatar'
import { cn } from '@/lib/utils'
import { Modal, Notice } from '@/notifications'
import { useNotification } from '@/notification-context'
import { useSession } from '@/session-context'
import { PlaylistSongSearchDialog } from '@/playlist-song-search'
import {
  usePlaylistText,
  playlistCoverSource,
  PlaylistFacts,
  PlaylistCard,
  PlaylistGrid,
  PlaylistGridSkeleton,
  emptyStateClassName,
} from '@/components/playlist-card'
import { PlaylistDialog, PlaylistCoverDialog } from '@/playlist-dialogs'

const sorts = ['updated', 'newest', 'favorites'] as const
type Sort = (typeof sorts)[number]

const panelClassName = 'rounded-[14px] border-2 border-outline bg-card p-6 shadow-drop'

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
        <PlaylistGridSkeleton />
      ) : (
        <>
          <PlaylistGrid
            items={data.items}
            empty={
              <h2 className="text-base font-extrabold">
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
          <h1 id="playlists-heading" className="text-3xl font-extrabold sm:text-4xl">
            {t('playlists.plaza')}
          </h1>
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
          <h2 id="system-playlists-heading" className="text-base font-extrabold">
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
        <h1 className="text-2xl font-extrabold sm:text-3xl">{t('playlists.mine')}</h1>
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
            className="text-3xl font-extrabold sm:text-4xl"
          >
            {t('playlists.mine')}
          </h1>
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
        <PlaylistGridSkeleton />
      ) : (
        <>
          <section className="space-y-4" aria-labelledby="owned-playlists-heading">
            <h2 id="owned-playlists-heading" className="text-base font-extrabold">
              {t('playlists.owned')}{' '}
              <span className="text-muted-foreground">{data.owned.length}</span>
            </h2>
            <PlaylistGrid
              items={data.owned}
              empty={<h3 className="text-base font-extrabold">{t('playlists.emptyOwned')}</h3>}
            />
          </section>
          <section className="space-y-4" aria-labelledby="favorite-playlists-heading">
            <h2 id="favorite-playlists-heading" className="text-base font-extrabold">
              {t('playlists.favorites')}{' '}
              <span className="text-muted-foreground">{data.favorites.length}</span>
            </h2>
            <PlaylistGrid
              items={data.favorites}
              empty={<h3 className="text-base font-extrabold">{t('playlists.emptyFavorites')}</h3>}
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

// The owner's view for arranging: one row per song with move and remove buttons.
function PlaylistSongOrder({
  charts,
  disabled,
  onMove,
  onRemove,
}: {
  charts: Chart[]
  disabled: boolean
  onMove: (index: number, offset: number) => void
  onRemove: (chart: Chart) => void
}) {
  const { t, i18n } = useTranslation()
  return (
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
              disabled={disabled || index === 0}
              aria-label={t('playlists.moveUp', { title })}
              onClick={() => onMove(index, -1)}
            >
              <ArrowUpIcon aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={disabled || index === charts.length - 1}
              aria-label={t('playlists.moveDown', { title })}
              onClick={() => onMove(index, 1)}
            >
              <ArrowDownIcon aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-destructive hover:text-destructive"
              disabled={disabled}
              aria-label={t('playlists.removeSong', { title })}
              onClick={() => onRemove(chart)}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </li>
        )
      })}
    </ol>
  )
}

export function PlaylistPage() {
  const { id = '' } = useParams()
  const { t } = useTranslation()
  const session = useSession()
  const navigate = useNavigate()
  const { notify } = useNotification()
  const playlistText = usePlaylistText()
  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<'' | 'edit' | 'cover' | 'delete' | 'songs'>('')
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
      className="inline-flex items-center gap-2 text-sm text-link hover:underline"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-4 shrink-0" />
      {t('playlists.back')}
    </Link>
  )
  if (error)
    return (
      <section className="space-y-6">
        {back}
        <Card role="alert" className="border-destructive p-6 text-destructive shadow-none">
          {error}
        </Card>
      </section>
    )
  if (!playlist)
    return (
      <section className="space-y-6" role="status" aria-label={t('playlists.loading')}>
        {back}
        <Skeleton className="h-56 rounded-[14px]" />
        <PlaylistGridSkeleton />
      </section>
    )
  const text = playlistText(playlist)
  const charts = playlist.charts ?? []
  const owned = !playlist.system && !!userId && playlist.ownerId === userId
  const source = playlistCoverSource(playlist)
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
  const addSong = (chart: Chart) =>
    void change([...charts, chart], () =>
      api(endpoints.playlistItem(playlist.id, chart.id), {
        method: 'PUT',
        headers: { 'X-CSRF-Token': session.csrfToken },
      }),
    )
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
        <div className="flex aspect-square w-full shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-muted sm:w-44">
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
              className="text-2xl font-extrabold wrap-anywhere sm:text-4xl"
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
                className="flex min-w-0 items-center gap-2 font-medium hover:text-link"
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
                <Button variant="outline" disabled={busy} onClick={() => setDialog('songs')}>
                  <PlusIcon aria-hidden="true" />
                  {t('playlists.addSongs')}
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
          <h2 className="text-base font-extrabold">{t('playlists.emptySongs')}</h2>
          {owned && <p>{t('playlists.emptySongsOwner')}</p>}
          {owned && (
            <Button variant="outline" onClick={() => setDialog('songs')}>
              <PlusIcon aria-hidden="true" />
              {t('playlists.addSongs')}
            </Button>
          )}
        </div>
      ) : arranging ? (
        <PlaylistSongOrder charts={charts} disabled={busy} onMove={move} onRemove={removeSong} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {charts.map((chart) => (
            <ChartCard key={chart.id} chart={chart} />
          ))}
        </div>
      )}
      {dialog === 'songs' && owned && (
        <PlaylistSongSearchDialog
          charts={charts}
          disabled={busy}
          onToggle={(chart, listed) => (listed ? removeSong(chart) : addSong(chart))}
          onDismiss={() => setDialog('')}
        />
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
