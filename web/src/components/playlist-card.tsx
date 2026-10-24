import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { HeartIcon, LockSimpleIcon, MusicNotesIcon } from '@phosphor-icons/react'
import { endpoints } from '@/api/endpoints'
import type { Playlist } from '@/api/types'
import { CategoryLabels } from '@/categories'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/user-avatar'
import { cn } from '@/lib/utils'
import { CardCoverBackdrop, coveredTextClassName, useCardCover } from '@/components/card-cover'

const systemIds = ['liked', 'popular', 'acclaimed', 'daily'] as const
export const emptyStateClassName =
  'flex flex-col items-center justify-center gap-4 rounded-[14px] border border-dashed bg-card/60 px-6 py-16 text-center [&>p]:max-w-lg [&>p]:text-muted-foreground'
// The server names system playlists in English; show them in the page language.
export function usePlaylistText() {
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

export const playlistCoverSource = (playlist: Pick<Playlist, 'id' | 'coverHash'>) =>
  playlist.coverHash ? endpoints.playlistCover(playlist.id, playlist.coverHash) : undefined

export function PlaylistFacts({ playlist }: { playlist: Playlist }) {
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

export function PlaylistCard({ playlist }: { playlist: Playlist }) {
  const { t } = useTranslation()
  const text = usePlaylistText()(playlist)
  const cover = useCardCover(playlistCoverSource(playlist))
  const hasCover = !!cover.source
  return (
    <Link
      className="group block min-w-0 rounded-[14px] outline-none transition-transform duration-150 focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-4 hover:-translate-y-0.5 motion-reduce:transform-none motion-reduce:transition-none"
      data-testid="playlist-card"
      to={`/playlists/${encodeURIComponent(playlist.id)}`}
    >
      <Card
        size="sm"
        className="relative isolate h-44 gap-3 px-6 py-5 transition-shadow group-hover:shadow-drop-hover"
      >
        {cover.source && <CardCoverBackdrop source={cover.source} onError={cover.onError} />}
        <div className={cn('relative min-w-0 space-y-1', hasCover && coveredTextClassName)}>
          <h3 className="truncate text-lg font-extrabold" title={text.name}>
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
        <div className="relative mt-auto space-y-3">
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

export function PlaylistGrid({ items, empty }: { items: Playlist[]; empty: ReactNode }) {
  if (!items.length) return <div className={emptyStateClassName}>{empty}</div>
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((playlist) => (
        <PlaylistCard key={playlist.id} playlist={playlist} />
      ))}
    </div>
  )
}

export function PlaylistGridSkeleton() {
  const { t } = useTranslation()
  return (
    <div
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      role="status"
      aria-label={t('playlists.loading')}
    >
      {[0, 1, 2].map((n) => (
        <Skeleton className="h-44 rounded-[14px]" key={n} />
      ))}
    </div>
  )
}
