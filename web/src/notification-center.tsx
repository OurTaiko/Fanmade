import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowBendUpLeftIcon,
  ArrowFatUpIcon,
  BellIcon,
  BellSimpleIcon,
  ChatCircleIcon,
  CheckIcon,
  EnvelopeSimpleIcon,
  ShieldWarningIcon,
  UploadSimpleIcon,
  XIcon,
} from '@phosphor-icons/react'
import { api, jsonRequest } from '@/api/client'
import { endpoints } from '@/api/endpoints'
import { errorCodeMessage } from '@/api/error-message'
import type { AppNotification, NotificationPage, NotificationSetting } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { UserAvatar } from '@/components/user-avatar'
import { loginPath } from '@/components/vote-control'
import { RelativeTime, commentPath, danCommentPath } from '@/comments'
import { danTitle } from '@/dan-title'
import { cn } from '@/lib/utils'
import { Notice } from '@/notifications'
import { useNotification } from '@/notification-context'
import { useSession } from '@/session-context'

// Any change to read state anywhere refreshes the bell's count.
const changedEvent = 'ourtaiko:notifications-changed'
const announceChange = () => window.dispatchEvent(new Event(changedEvent))

function useNotificationText() {
  const { t, i18n } = useTranslation()
  return (n: AppNotification) => {
    const actor = n.actor?.nickname || t('messages.unknownMember')
    // Comment notices name the song or the course the thread is on.
    const chart = n.chart?.title ?? (n.dan ? danTitle(n.dan.title, i18n.resolvedLanguage) : '')
    const count = n.data.upvotes ?? 0
    switch (n.kind) {
      case 'chart_collaboration':
        return t('collaboration.notice', { actor, chart })
      case 'comment_reply':
        return t('notificationCenter.text.comment_reply', { actor, chart })
      case 'chart_comment':
        return t('notificationCenter.text.chart_comment', { actor, chart })
      case 'chart_upvotes':
        return t('notificationCenter.text.chart_upvotes', { chart, count })
      case 'dan_comment':
        return t('notificationCenter.text.dan_comment', { actor, chart })
      case 'dan_upvotes':
        return t('notificationCenter.text.dan_upvotes', { chart, count })
      case 'comment_upvotes':
        return t('notificationCenter.text.comment_upvotes', { chart, count })
      case 'comment_removed':
        return t('notificationCenter.text.comment_removed', { chart })
      case 'playlist_removed':
        return t('notificationCenter.text.playlist_removed', { name: n.data.name ?? '' })
      case 'upload_result': {
        const title = n.data.title || chart
        if (n.data.status === 'failed')
          return t('notificationCenter.text.upload_failed', {
            title,
            reason: errorCodeMessage(n.data.code ?? ''),
          })
        const updated = n.data.status === 'updated'
        const skipped = (n.data.failedFiles ?? []).map(({ file, code }) =>
          t('notificationCenter.text.upload_skipped_file', {
            file:
              file === 'cover'
                ? t('notificationCenter.file.cover')
                : file === 'movie'
                  ? t('notificationCenter.file.movie')
                  : file,
            reason: errorCodeMessage(code),
          }),
        )
        if (!skipped.length)
          return t(`notificationCenter.text.${updated ? 'upload_updated' : 'upload_published'}`, {
            title,
          })
        return t(
          `notificationCenter.text.${updated ? 'upload_updated_partial' : 'upload_published_partial'}`,
          { title, files: new Intl.ListFormat(i18n.resolvedLanguage).format(skipped) },
        )
      }
      default:
        return t('notificationCenter.text.unknown')
    }
  }
}

function target(n: AppNotification) {
  if (n.kind === 'chart_collaboration' && n.data.status === 'pending') return '/notifications'
  if (n.chart && n.comment) return commentPath(n.chart.id, n.comment.id)
  if (n.chart) return `/charts/${encodeURIComponent(n.chart.id)}`
  if (n.dan && n.comment) return danCommentPath(n.dan.id, n.comment.id)
  if (n.dan) return `/dans/${encodeURIComponent(n.dan.id)}`
  return null
}

const kindIcons: Record<string, ReactNode> = {
  comment_reply: <ArrowBendUpLeftIcon />,
  chart_comment: <ChatCircleIcon />,
  chart_upvotes: <ArrowFatUpIcon weight="fill" className="text-[#ff4500]" />,
  dan_comment: <ChatCircleIcon />,
  dan_upvotes: <ArrowFatUpIcon weight="fill" className="text-[#ff4500]" />,
  comment_upvotes: <ArrowFatUpIcon weight="fill" className="text-[#ff4500]" />,
  comment_removed: <ShieldWarningIcon className="text-destructive" />,
  upload_result: <UploadSimpleIcon />,
  playlist_removed: <ShieldWarningIcon className="text-destructive" />,
}

function NotificationIcon({ n }: { n: AppNotification }) {
  if (n.actor)
    return (
      <span className="relative shrink-0">
        <UserAvatar
          nickname={n.actor.nickname || '?'}
          avatarUrl={n.actor.avatarUrl}
          className="size-9"
        />
        <span className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-background shadow-[0_2px_8px_rgba(0,0,0,0.08)] [&_svg]:size-3">
          {kindIcons[n.kind] ?? <BellSimpleIcon />}
        </span>
      </span>
    )
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#f5f5f7] dark:bg-muted [&_svg]:size-4">
      {kindIcons[n.kind] ?? <BellSimpleIcon />}
    </span>
  )
}

function NotificationContent({ n }: { n: AppNotification }) {
  const text = useNotificationText()
  return (
    <span className="min-w-0 flex-1 space-y-1">
      <span className={cn('block text-sm leading-snug', !n.read && 'font-medium')}>{text(n)}</span>
      {n.comment?.excerpt && (
        <span className="line-clamp-2 block text-sm text-muted-foreground wrap-anywhere">
          {n.comment.excerpt}
        </span>
      )}
      <span className="block text-xs text-muted-foreground">
        <RelativeTime value={n.createdAt} />
      </span>
    </span>
  )
}

function UnreadDot({ read }: { read: boolean }) {
  const { t } = useTranslation()
  return read ? (
    <span className="size-2 shrink-0" aria-hidden="true" />
  ) : (
    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-[#0071e3]">
      <span className="sr-only">{t('notificationCenter.unread')}</span>
    </span>
  )
}

const markRead = (n: AppNotification, csrf: string) =>
  n.read
    ? Promise.resolve()
    : api(endpoints.notification(n.id), jsonRequest('PATCH', { read: true }, csrf)).then(
        announceChange,
      )

// Header bell: unread badge plus a menu with the latest notifications.
export function NotificationBell() {
  const { t } = useTranslation()
  const { user, csrfToken } = useSession()
  const location = useLocation()
  const navigate = useNavigate()
  const [count, setCount] = useState(0)
  const [recent, setRecent] = useState<AppNotification[] | null>(null)
  const refresh = useCallback(() => {
    if (!user) return
    api<{ count: number }>(endpoints.notificationsUnread)
      .then((r) => setCount(r.count))
      .catch(() => {})
  }, [user])
  useEffect(() => {
    if (!user) {
      setCount(0)
      return
    }
    refresh()
    const timer = window.setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    window.addEventListener(changedEvent, refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener(changedEvent, refresh)
    }
  }, [user, refresh, location.pathname])
  if (!user) return null
  const open = (n: AppNotification) => {
    void markRead(n, csrfToken).catch(() => {})
    const to = target(n)
    navigate(to ?? '/notifications')
  }
  return (
    <DropdownMenu
      onOpenChange={(isOpen) => {
        if (!isOpen) return
        setRecent(null)
        api<NotificationPage>(endpoints.notifications({ filter: 'all', page: 1 }))
          .then((r) => {
            setRecent(r.items.slice(0, 6))
            setCount(r.unread)
          })
          .catch(() => setRecent([]))
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={
              count ? t('notificationCenter.bellUnread', { count }) : t('notificationCenter.title')
            }
          />
        }
      >
        <BellIcon className="size-4" aria-hidden="true" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-[#ff3b30] px-1 text-center text-[10px] leading-4 font-semibold text-white tabular-nums">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-1">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-sm font-semibold">{t('notificationCenter.title')}</span>
          {count > 0 && (
            <span className="text-xs text-muted-foreground">
              {t('notificationCenter.unreadCount', { count })}
            </span>
          )}
        </div>
        <DropdownMenuSeparator />
        {recent === null ? (
          <div className="space-y-2 p-2" role="status" aria-label={t('notificationCenter.loading')}>
            <Skeleton className="h-12 rounded-xl" />
            <Skeleton className="h-12 rounded-xl" />
          </div>
        ) : recent.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {t('notificationCenter.empty')}
          </p>
        ) : (
          recent.map((n) => (
            <DropdownMenuItem
              key={n.id}
              className="items-start gap-3 rounded-xl p-2"
              onClick={() => open(n)}
            >
              <NotificationIcon n={n} />
              <NotificationContent n={n} />
              <UnreadDot read={n.read} />
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        {count > 0 && (
          <DropdownMenuItem
            onClick={() => {
              void api(endpoints.notificationsRead, jsonRequest('POST', {}, csrfToken))
                .then(announceChange)
                .catch(() => {})
            }}
          >
            <CheckIcon />
            {t('notificationCenter.markAllRead')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem render={<Link to="/notifications" />}>
          <BellSimpleIcon />
          {t('notificationCenter.viewAll')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const settingLabels = {
  comment_reply: 'notificationCenter.settings.comment_reply',
  chart_comment: 'notificationCenter.settings.chart_comment',
  chart_upvotes: 'notificationCenter.settings.chart_upvotes',
  comment_upvotes: 'notificationCenter.settings.comment_upvotes',
  comment_removed: 'notificationCenter.settings.comment_removed',
} as const

function NotificationSettings() {
  const { t } = useTranslation()
  const { csrfToken } = useSession()
  const { notify } = useNotification()
  const [items, setItems] = useState<NotificationSetting[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    api<{ items: NotificationSetting[] }>(endpoints.notificationSettings, {
      signal: controller.signal,
    })
      .then((r) => setItems(r.items))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [])
  const toggle = async (kind: string, enabled: boolean) => {
    const previous = items
    setItems((current) => current?.map((s) => (s.kind === kind ? { ...s, enabled } : s)) ?? null)
    try {
      const r = await api<{ items: NotificationSetting[] }>(
        endpoints.notificationSettings,
        jsonRequest('PUT', { [kind]: enabled }, csrfToken),
      )
      setItems(r.items)
    } catch (e) {
      setItems(previous)
      notify((e as Error).message, 'error')
    }
  }
  return (
    <section
      aria-labelledby="notification-settings-heading"
      className="space-y-4 rounded-2xl bg-white p-6 shadow-[0_4px_12px_rgba(0,0,0,0.08)] dark:bg-card"
    >
      <div className="space-y-1">
        <h2 id="notification-settings-heading" className="text-lg font-semibold tracking-tight">
          {t('notificationCenter.settingsTitle')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('notificationCenter.settingsDescription')}
        </p>
      </div>
      {error ? (
        <Notice>{error}</Notice>
      ) : !items ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : (
        <ul className="space-y-3">
          {items.map((s) => (
            <li key={s.kind}>
              <label className="flex cursor-pointer items-center gap-3 text-sm">
                <Checkbox
                  checked={s.enabled}
                  onCheckedChange={(checked) => void toggle(s.kind, checked === true)}
                />
                {s.kind in settingLabels
                  ? t(settingLabels[s.kind as keyof typeof settingLabels])
                  : s.kind}
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function NotificationsPage() {
  const { t } = useTranslation()
  const { user, csrfToken, loading } = useSession()
  const { notify } = useNotification()
  const location = useLocation()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<NotificationPage | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [responding, setResponding] = useState<string | null>(null)
  useEffect(() => {
    if (!user) return
    const controller = new AbortController()
    setError('')
    api<NotificationPage>(endpoints.notifications({ filter, page }), { signal: controller.signal })
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [user, filter, page, attempt])
  // Step back when the last notice of a later page was dismissed.
  useEffect(() => {
    if (data && data.items.length === 0 && page > 1) setPage(page - 1)
  }, [data, page])
  // Refresh when another view (such as the bell menu) changes read state.
  useEffect(() => {
    const reload = () => setAttempt((n) => n + 1)
    window.addEventListener(changedEvent, reload)
    return () => window.removeEventListener(changedEvent, reload)
  }, [])
  if (loading) return <p className="text-sm text-muted-foreground">{t('messages.connecting')}</p>
  if (!user)
    return (
      <Notice kind="info" title={t('notificationCenter.title')}>
        <Link to={loginPath(location)} className="text-[#0071e3] hover:underline">
          {t('notificationCenter.signIn')}
        </Link>
      </Notice>
    )
  const run = async (request: Promise<unknown>) => {
    try {
      await request
      announceChange()
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }
  const respond = async (n: AppNotification, accept: boolean) => {
    setResponding(n.id)
    try {
      await run(
        api(endpoints.respondCollaboration(n.id), jsonRequest('POST', { accept }, csrfToken)),
      )
    } finally {
      setResponding(null)
    }
  }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  return (
    <section className="mx-auto grid max-w-5xl items-start gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight">
              {t('notificationCenter.title')}
            </h1>
            {data && (
              <p className="text-sm text-muted-foreground">
                {t('notificationCenter.unreadCount', { count: data.unread })}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            disabled={!data?.unread}
            onClick={() =>
              void run(api(endpoints.notificationsRead, jsonRequest('POST', {}, csrfToken)))
            }
          >
            <CheckIcon />
            {t('notificationCenter.markAllRead')}
          </Button>
        </div>
        <div
          role="tablist"
          aria-label={t('notificationCenter.filter')}
          className="inline-flex rounded-full bg-[#f5f5f7] p-1 dark:bg-muted"
        >
          {(['all', 'unread'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              className={cn(
                'rounded-full px-4 py-1.5 text-sm transition-all duration-200 active:scale-[0.96] motion-reduce:transition-none',
                filter === value
                  ? 'bg-white font-medium shadow-[0_2px_8px_rgba(0,0,0,0.04)] dark:bg-background'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => {
                setFilter(value)
                setPage(1)
                setData(null)
              }}
            >
              {value === 'all' ? t('notificationCenter.all') : t('notificationCenter.unread')}
            </button>
          ))}
        </div>
        {error ? (
          <div className="flex flex-col items-start gap-3">
            <Notice>{error}</Notice>
            <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
              {t('messages.retry')}
            </Button>
          </div>
        ) : !data ? (
          <div className="space-y-3" role="status" aria-label={t('notificationCenter.loading')}>
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
          </div>
        ) : data.items.length === 0 ? (
          <p className="rounded-2xl bg-[#f5f5f7] py-12 text-center text-sm text-muted-foreground dark:bg-muted">
            {filter === 'unread' ? t('notificationCenter.noUnread') : t('notificationCenter.empty')}
          </p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-2xl bg-white shadow-[0_4px_12px_rgba(0,0,0,0.08)] dark:bg-card">
            {data.items.map((n) => {
              const to = target(n)
              return (
                <li
                  key={n.id}
                  className={cn(
                    'flex flex-wrap items-start gap-3 p-4',
                    !n.read && 'bg-[#0071e3]/5',
                  )}
                >
                  <UnreadDot read={n.read} />
                  <button
                    type="button"
                    disabled={!to}
                    className="flex min-w-0 flex-1 items-start gap-3 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3] disabled:cursor-default"
                    onClick={() => {
                      if (!to) return
                      void markRead(n, csrfToken).catch(() => {})
                      navigate(to)
                    }}
                  >
                    <NotificationIcon n={n} />
                    <NotificationContent n={n} />
                  </button>
                  {n.kind === 'chart_collaboration' && (
                    <div
                      className="order-last flex w-full flex-wrap items-center gap-2 pl-5 text-sm"
                      role="status"
                    >
                      {n.data.status === 'pending' ? (
                        <>
                          <p className="w-full text-muted-foreground">
                            {t('collaboration.permissions')}
                          </p>
                          <Button
                            size="sm"
                            disabled={responding !== null}
                            onClick={() => void respond(n, true)}
                          >
                            {t('collaboration.accept')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={responding !== null}
                            onClick={() => void respond(n, false)}
                          >
                            {t('collaboration.decline')}
                          </Button>
                        </>
                      ) : (
                        t(
                          n.data.status === 'accepted'
                            ? 'collaboration.accepted'
                            : 'collaboration.declined',
                        )
                      )}
                    </div>
                  )}
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={
                        n.read
                          ? t('notificationCenter.markUnread')
                          : t('notificationCenter.markRead')
                      }
                      title={
                        n.read
                          ? t('notificationCenter.markUnread')
                          : t('notificationCenter.markRead')
                      }
                      onClick={() =>
                        void run(
                          api(
                            endpoints.notification(n.id),
                            jsonRequest('PATCH', { read: !n.read }, csrfToken),
                          ),
                        )
                      }
                    >
                      {n.read ? <EnvelopeSimpleIcon /> : <CheckIcon />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={n.kind === 'chart_collaboration' && n.data.status === 'pending'}
                      aria-label={t('notificationCenter.dismiss')}
                      title={t('notificationCenter.dismiss')}
                      onClick={() =>
                        void run(
                          api(endpoints.notification(n.id), jsonRequest('DELETE', {}, csrfToken)),
                        )
                      }
                    >
                      <XIcon />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {data && pages > 1 && (
          <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
            <Button variant="outline" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>
              {t('messages.previous')}
            </Button>
            <span>{t('messages.pagination', { page, pages })}</span>
            <Button
              variant="outline"
              disabled={page >= pages}
              onClick={() => setPage((n) => n + 1)}
            >
              {t('messages.next')}
            </Button>
          </div>
        )}
      </div>
      <aside className="space-y-4">
        <NotificationSettings />
      </aside>
    </section>
  )
}
