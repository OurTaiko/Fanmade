import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, jsonRequest } from '@sitekit/api/client'
import { endpoints } from '@/api/endpoints'
import type { Chart, UserDirectory } from '@/api/types'
import { isChartOwner } from '@/chart-owners'
import { Button } from '@sitekit/components/ui/button'
import { SearchInput } from '@sitekit/components/search-input'
import { UserAvatar } from '@sitekit/components/user-avatar'
import { Modal, Notice } from '@sitekit/notifications'
import { useSession } from '@/session-context'
import { useNotification } from '@sitekit/notification-context'

export function CollaborationDialog({ chart, onDismiss }: { chart: Chart; onDismiss: () => void }) {
  const { t } = useTranslation()
  const { csrfToken } = useSession()
  const { notify } = useNotification()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<UserDirectory | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setResult(null)
    setError('')
    setSelected(null)
    api<UserDirectory>(endpoints.users({ q: query, sort: 'active', page }), {
      signal: controller.signal,
    })
      .then(setResult)
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [query, page])
  const invite = async () => {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      await api(
        endpoints.collaborations(chart.id),
        jsonRequest('POST', { userId: selected }, csrfToken),
      )
      setSent((ids) => [...ids, selected])
      setSelected(null)
      notify(t('collaboration.sent'), 'success')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={t('collaboration.add')}
      onDismiss={onDismiss}
      busy={busy}
      actions={
        <Button disabled={!selected || busy || pending} onClick={() => void invite()}>
          {t('collaboration.invite')}
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('collaboration.description')}</p>
        <SearchInput
          value={query}
          label={t('collaboration.search')}
          placeholder={t('collaboration.search')}
          onSearch={(value) => {
            setQuery(value)
            setPage(1)
          }}
          onPendingChange={setPending}
        />
        {error && <Notice>{error}</Notice>}
        {!result && !error && <p role="status">{t('messages.connecting')}</p>}
        {result && (
          <div
            className="max-h-72 space-y-2 overflow-y-auto"
            role="group"
            aria-label={t('collaboration.search')}
          >
            {result.items.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('collaboration.noUsers')}</p>
            )}
            {result.items.map((user) => {
              const owned = isChartOwner(chart, user.id)
              const invited = sent.includes(user.id)
              return (
                <button
                  key={user.id}
                  type="button"
                  disabled={owned || invited || busy || pending}
                  aria-pressed={selected === user.id}
                  onClick={() => setSelected(user.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left active:scale-[0.98] disabled:opacity-50 ${selected === user.id ? 'border-primary bg-primary/5' : 'border-transparent bg-muted/40'}`}
                >
                  <UserAvatar
                    nickname={user.nickname || t('messages.unknownMember')}
                    avatarUrl={user.avatarUrl}
                    className="size-8"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {user.nickname || t('messages.unknownMember')}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{user.id}</span>
                  </span>
                  {owned ? t('collaboration.owner') : invited ? t('collaboration.pending') : null}
                </button>
              )
            })}
          </div>
        )}
        {result && result.total > result.pageSize && (
          <div className="flex justify-between gap-3">
            <Button
              variant="outline"
              disabled={page <= 1 || busy || pending}
              onClick={() => setPage(page - 1)}
            >
              {t('messages.previous')}
            </Button>
            <Button
              variant="outline"
              disabled={page * result.pageSize >= result.total || busy || pending}
              onClick={() => setPage(page + 1)}
            >
              {t('messages.next')}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
