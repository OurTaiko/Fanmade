import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PlusIcon } from '@phosphor-icons/react'
import { api, jsonRequest } from '@sitekit/api/client'
import { endpoints } from '@/api/endpoints'
import type { Chart, MyPlaylists, Playlist } from '@/api/types'
import { CategorySelect } from '@/categories'
import { CoverUploadDialog } from '@sitekit/components/cover-dialog'
import { ToggleRow } from '@sitekit/components/toggle-row'
import { Button } from '@sitekit/components/ui/button'
import { Checkbox } from '@sitekit/components/ui/checkbox'
import { DialogClose } from '@sitekit/components/ui/dialog'
import { Input } from '@sitekit/components/ui/input'
import { Label } from '@sitekit/components/ui/label'
import { Textarea } from '@sitekit/components/ui/textarea'
import { Modal } from '@sitekit/notifications'
import { useSession } from '@/session-context'

// Creates a playlist, or edits the one given.
export function PlaylistDialog({
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
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </Modal>
  )
}

export function PlaylistCoverDialog({
  playlist,
  onSaved,
  onDismiss,
}: {
  playlist: Playlist
  onSaved: (coverHash: string) => void
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  return (
    <CoverUploadDialog
      title={t('playlists.changeCover')}
      endpoint={endpoints.playlistCover(playlist.id)}
      removeLabel={playlist.coverHash ? t('playlists.removeCover') : undefined}
      onSaved={onSaved}
      onDismiss={onDismiss}
    />
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
              <ToggleRow
                key={playlist.id}
                title={playlist.name}
                detail={`${t('playlists.songCount', { count: playlist.chartCount })} · ${
                  playlist.public ? t('playlists.public') : t('playlists.private')
                }`}
                pressed={!!playlist.containsChart}
                pressedLabel={t('playlists.inPlaylist')}
                disabled={busy || (!playlist.containsChart && playlist.chartCount >= data.maxItems)}
                onToggle={() => void toggle(playlist)}
              />
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
