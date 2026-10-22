import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowClockwiseIcon, UsersIcon } from '@phosphor-icons/react'
import { api } from '@/api/client'
import { endpoints } from '@/api/endpoints'
import type { UserDirectory } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ChoiceSelect } from '@/components/choice-select'
import { SearchInput } from '@/components/search-input'
import { PublicUserCard } from '@/components/public-user-card'

export function UsersPage() {
  const { t } = useTranslation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const sort = params.get('sort') === 'newest' ? 'newest' : 'active'
  const rawPage = Number(params.get('page'))
  const page = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 10000 ? rawPage : 1
  const [result, setResult] = useState<UserDirectory | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchPending, setSearchPending] = useState(false)
  const [refresh, setRefresh] = useState(0)
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
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    api<UserDirectory>(endpoints.users({ q, sort, page }), { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult(data)
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [q, sort, page, refresh])
  const update = (values: Record<string, string>) => setParams({ q, sort, page: '1', ...values })
  const busy = loading || searchPending
  return (
    <section className="space-y-8" aria-labelledby="users-heading">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
        <div className="space-y-3">
          <h1 id="users-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {t('messages.userSquare')}
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {t('messages.userSquareDescription')}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setRefresh((n) => n + 1)}
          disabled={loading}
          className="self-start rounded-full active:scale-[0.98] sm:self-auto"
        >
          <ArrowClockwiseIcon aria-hidden="true" />
          {t('messages.refreshUsers')}
        </Button>
      </div>
      <div
        role="search"
        aria-label={t('messages.searchMembers')}
        className="flex flex-col gap-3 sm:flex-row"
      >
        <SearchInput
          value={q}
          onSearch={search}
          onPendingChange={setSearchPending}
          label={t('messages.searchMembers')}
          placeholder={t('messages.searchMembersPlaceholder')}
        />
        <ChoiceSelect
          label={t('messages.sortMembers')}
          value={sort}
          onValueChange={(value) => update({ sort: value })}
          items={[
            { value: 'active', label: t('messages.recentlyActiveMembers') },
            { value: 'newest', label: t('messages.newestMembers') },
          ]}
        />
      </div>
      <div
        className="flex items-center gap-2 text-sm text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <UsersIcon className="size-4" aria-hidden="true" />
        {busy
          ? t('messages.loadingMembers')
          : error
            ? t('messages.membersUnavailable')
            : t('messages.membersTotal', { total: result?.total ?? 0 })}
      </div>
      {error ? (
        <Card role="alert" className="rounded-2xl border p-6 text-destructive shadow-none ring-0">
          {error}
        </Card>
      ) : busy ? (
        <div
          className="grid gap-5 md:grid-cols-2 xl:grid-cols-3"
          aria-busy="true"
          aria-label={t('messages.loadingMembers')}
        >
          {[0, 1, 2].map((n) => (
            <Skeleton key={n} className="h-96 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          {result && !result.profilesAvailable && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('messages.memberNamesUnavailable')}
            </p>
          )}
          {result?.items.length ? (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {result.items.map((user) => (
                <article key={user.id} aria-label={user.nickname ?? t('messages.unknownMember')}>
                  <PublicUserCard user={user} />
                </article>
              ))}
            </div>
          ) : (
            <Card className="items-center gap-3 rounded-2xl border border-dashed px-6 py-16 text-center shadow-none ring-0">
              <UsersIcon className="mb-2 size-8 text-muted-foreground" aria-hidden="true" />
              <h2 className="text-lg font-semibold">
                {q ? t('messages.noMatchingMembers') : t('messages.noMembersOnThisPage')}
              </h2>
              <p className="max-w-lg text-sm text-muted-foreground">
                {q ? t('messages.tryAnotherNickname') : t('messages.memberDirectoryEmpty')}
              </p>
              {(q || page > 1) && (
                <Button variant="outline" onClick={() => setParams({ sort })}>
                  {t('messages.showAllMembers')}
                </Button>
              )}
            </Card>
          )}
          {result && result.total > result.pageSize && (
            <nav
              aria-label={t('messages.memberPagination')}
              className="flex flex-wrap items-center justify-center gap-4 text-sm"
            >
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => update({ page: String(page - 1) })}
              >
                {t('messages.previous')}
              </Button>
              <span>
                {t('messages.pagination', {
                  page,
                  pages: Math.ceil(result.total / result.pageSize),
                })}
              </span>
              <Button
                variant="outline"
                disabled={page * result.pageSize >= result.total}
                onClick={() => update({ page: String(page + 1) })}
              >
                {t('messages.next')}
              </Button>
            </nav>
          )}
        </>
      )}
      <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
        {t('messages.memberActivityNote')}
      </p>
    </section>
  )
}
