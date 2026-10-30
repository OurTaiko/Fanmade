import { isChartOwner } from '@sitekit/chart-owners'
import { danTitle } from '@sitekit/dan-title'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import {
  ArrowBendUpLeftIcon,
  ArrowRightIcon,
  ChatCircleIcon,
  LinkSimpleIcon,
  MinusIcon,
  PencilSimpleIcon,
  PlusIcon,
  ShieldWarningIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import { api, jsonRequest } from '@sitekit/api/client'
import { endpoints } from '@/api/endpoints'
import type {
  Chart,
  Comment,
  Dan,
  CommentList,
  CommentPage,
  CommentSort,
  CommentThread,
  Vote,
  VoteResult,
} from '@/api/types'
import { formatLocale } from '@sitekit/i18n'
import { cn } from '@sitekit/lib/utils'
import { Button, buttonVariants } from '@sitekit/components/ui/button'
import { DialogClose } from '@sitekit/components/ui/dialog'
import { Textarea } from '@sitekit/components/ui/textarea'
import { Skeleton } from '@sitekit/components/ui/skeleton'
import { ChoiceSelect } from '@sitekit/components/choice-select'
import { UserAvatar } from '@sitekit/components/user-avatar'
import { VoteControl, loginPath } from '@sitekit/components/vote-control'
import { Modal, Notice } from '@sitekit/notifications'
import { useNotification } from '@sitekit/notification-context'
import { useSession } from '@/session-context'

const maxCommentLength = 10000
// Deeper replies continue on the comment's own page, as on Reddit.
const maxVisibleDepth = 8
// Comments at or below this score start collapsed.
const collapseScore = -5

export const commentPath = (chartId: string, commentId: string) =>
  `/charts/${encodeURIComponent(chartId)}/comments/${encodeURIComponent(commentId)}`
export const danCommentPath = (danId: string, commentId: string) =>
  `/dans/${encodeURIComponent(danId)}/comments/${encodeURIComponent(commentId)}`

// What a thread hangs on: a song or a 段位 course. The pages and endpoints
// differ; the comments themselves do not.
export type CommentSubject = {
  /** The page the thread lives on, e.g. /charts/abc or /dans/12. */
  path: string
  commentCount: number
  comments: (query: { sort: string; page: number }) => string
  newComment: string
  commentPath: (commentId: string) => string
  isOwner: (userId: string) => boolean
  /** The new-comment box's prompt names what the thread is about. */
  placeholder: 'interactions.commentPlaceholder' | 'interactions.danCommentPlaceholder'
}

export function chartSubject(chart: Chart): CommentSubject {
  return {
    path: `/charts/${encodeURIComponent(chart.id)}`,
    commentCount: chart.commentCount,
    comments: (query) => endpoints.chartComments(chart.id, query),
    newComment: endpoints.newComment(chart.id),
    commentPath: (id) => commentPath(chart.id, id),
    isOwner: (userId) => isChartOwner(chart, userId),
    placeholder: 'interactions.commentPlaceholder',
  }
}

export function danSubject(dan: Dan): CommentSubject {
  return {
    path: `/dans/${encodeURIComponent(dan.id)}`,
    commentCount: dan.commentCount,
    comments: (query) => endpoints.danComments(dan.id, query),
    newComment: `${endpoints.dan(dan.id)}/comments`,
    commentPath: (id) => danCommentPath(dan.id, id),
    isOwner: (userId) => userId === dan.ownerId,
    placeholder: 'interactions.danCommentPlaceholder',
  }
}

// Where a comment outside its thread (a history, a notice) links to.
export function commentSubjectPath(comment: Pick<Comment, 'chartId' | 'danId'>) {
  return comment.danId
    ? `/dans/${encodeURIComponent(comment.danId)}`
    : `/charts/${encodeURIComponent(comment.chartId ?? '')}`
}
export function commentPermalink(comment: Pick<Comment, 'id' | 'chartId' | 'danId'>) {
  return comment.danId
    ? danCommentPath(comment.danId, comment.id)
    : commentPath(comment.chartId ?? '', comment.id)
}

export function RelativeTime({ value }: { value: string }) {
  const { i18n } = useTranslation()
  const date = new Date(value)
  const locale = formatLocale(i18n.language)
  const seconds = Math.round((date.getTime() - Date.now()) / 1000)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  const [unit, size] = units.find(([, size]) => Math.abs(seconds) >= size) ?? ['second', 1]
  const text =
    unit === 'second'
      ? new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'second')
      : new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
          Math.trunc(seconds / size),
          unit,
        )
  return (
    <time
      dateTime={value}
      title={date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
    >
      {text}
    </time>
  )
}

// Plain text with web links. Text is never interpreted as HTML or Markdown.
export function CommentBody({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}，。！？）】])/g)
  return (
    <p className="max-w-[70ch] whitespace-pre-wrap text-sm leading-6 wrap-anywhere">
      {parts.map((part, i) =>
        i % 2 ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="text-link hover:underline"
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  )
}

function Composer({
  initial = '',
  placeholder,
  submitLabel,
  autoFocus = false,
  onSubmit,
  onCancel,
}: {
  initial?: string
  placeholder: string
  submitLabel: string
  autoFocus?: boolean
  onSubmit: (body: string) => Promise<void>
  onCancel?: () => void
}) {
  const { t } = useTranslation()
  const { notify } = useNotification()
  const [body, setBody] = useState(initial)
  const [busy, setBusy] = useState(false)
  const length = Array.from(body.trim()).length
  const submit = async () => {
    if (busy || length === 0 || length > maxCommentLength) return
    setBusy(true)
    try {
      await onSubmit(body)
      setBody('')
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <Textarea
        value={body}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={placeholder}
        maxLength={maxCommentLength + 200}
        disabled={busy}
        className="min-h-24 bg-muted dark:bg-input/50"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void submit()
          }
          if (e.key === 'Escape' && onCancel) onCancel()
        }}
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {length > maxCommentLength * 0.9 && (
          <span
            className={cn(
              'mr-auto text-xs tabular-nums text-muted-foreground',
              length > maxCommentLength && 'text-destructive',
            )}
          >
            {t('interactions.characterCount', { count: length, max: maxCommentLength })}
          </span>
        )}
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
            {t('messages.cancel')}
          </Button>
        )}
        <Button
          type="submit"
          size="sm"
          disabled={busy || length === 0 || length > maxCommentLength}
          className="active:scale-[0.96]"
        >
          {busy ? t('interactions.posting') : submitLabel}
        </Button>
      </div>
    </form>
  )
}

type Tree = {
  subject: CommentSubject
  focusId?: string
  update: (id: string, change: (comment: Comment) => Comment) => void
  addReply: (parentId: string, reply: Comment) => void
  remove: (id: string, purged: boolean, removed: boolean) => void
}
const TreeContext = createContext<Tree | null>(null)

function mapTree(items: Comment[], id: string, change: (c: Comment) => Comment): Comment[] {
  return items.map((c) =>
    c.id === id ? change(c) : { ...c, replies: mapTree(c.replies, id, change) },
  )
}

// Mirrors the server: a purged comment disappears, then any deleted placeholder
// left without replies disappears as well.
function purge(items: Comment[], id: string): Comment[] {
  return items
    .filter((c) => c.id !== id)
    .map((c) => {
      const replies = purge(c.replies, id)
      return replies.length === c.replies.length
        ? c
        : { ...c, replies, replyCount: c.replyCount - 1 }
    })
    .filter((c) => !((c.deleted || c.removed) && c.replyCount === 0))
}

function countTree(items: Comment[]): number {
  return items.reduce((n, c) => n + 1 + countTree(c.replies), 0)
}

function CommentNode({ comment, level }: { comment: Comment; level: number }) {
  const { t } = useTranslation()
  const tree = useContext(TreeContext)!
  const { user, csrfToken } = useSession()
  const { notify } = useNotification()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(comment.score <= collapseScore)
  const [replying, setReplying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const gone = comment.deleted || comment.removed
  const own = !!user && user.id === comment.authorId
  const canModerate = !!user?.isAdmin && !own
  const focused = tree.focusId === comment.id
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!focused) return
    // The chart preview above loads later and grows the page. Keep the linked
    // comment in view while the layout settles, until the reader scrolls.
    const keep = () => ref.current?.scrollIntoView({ block: 'center' })
    keep()
    const observer = new ResizeObserver(keep)
    // body has a fixed height; the page content grows inside main.
    observer.observe(ref.current?.closest('main') ?? document.documentElement)
    const stop = () => observer.disconnect()
    const timer = window.setTimeout(stop, 4000)
    const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const
    events.forEach((e) => window.addEventListener(e, stop, { once: true, passive: true }))
    return () => {
      stop()
      window.clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, stop))
    }
  }, [focused])
  const permalink = tree.subject.commentPath(comment.id)
  const author = gone ? '' : comment.author || t('messages.unknownMember')
  const hiddenReplies = comment.replyCount - comment.replies.length
  const remove = async () => {
    setBusy(true)
    try {
      const result = await api<{ purged: boolean }>(
        endpoints.comment(comment.id),
        jsonRequest('DELETE', {}, csrfToken),
      )
      setConfirm(false)
      tree.remove(comment.id, result.purged, canModerate)
      notify(
        canModerate ? t('interactions.commentRemoved') : t('interactions.commentDeleted'),
        'success',
      )
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <article
      ref={ref}
      id={`comment-${comment.id}`}
      aria-label={t('interactions.commentBy', {
        author: author || t('interactions.deletedAuthor'),
      })}
      className="min-w-0 scroll-mt-24"
    >
      <div className="flex gap-2">
        <div className="flex shrink-0 flex-col items-center">
          {gone ? (
            <span className="size-6 rounded-full bg-muted" aria-hidden="true" />
          ) : (
            <Link
              to={`/users/${encodeURIComponent(comment.authorId)}`}
              tabIndex={-1}
              aria-hidden="true"
            >
              <UserAvatar
                nickname={author}
                avatarUrl={comment.authorAvatarUrl}
                className="size-6"
                fallbackClassName="text-xs"
              />
            </Link>
          )}
          {!collapsed && comment.replies.length > 0 && (
            <button
              type="button"
              className="group mt-1 flex w-4 flex-1 justify-center outline-none"
              aria-label={t('interactions.collapseThread')}
              onClick={() => setCollapsed(true)}
            >
              <span className="w-px bg-border transition-colors group-hover:bg-link group-focus-visible:bg-link" />
            </button>
          )}
        </div>
        <div className="min-w-0 flex-1 pb-1">
          <header className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {gone ? (
              <span className="italic">{t('interactions.deletedAuthor')}</span>
            ) : (
              <Link
                to={`/users/${encodeURIComponent(comment.authorId)}`}
                className="max-w-48 truncate font-medium text-foreground hover:underline"
              >
                {author}
              </Link>
            )}
            {!gone && tree.subject.isOwner(comment.authorId) && (
              <span
                className="rounded-md bg-link/10 px-1.5 py-0.5 font-medium text-link"
                title={t('collaboration.ownerBadgeTitle')}
              >
                {t('collaboration.owner')}
              </span>
            )}
            <span aria-hidden="true">·</span>
            <Link to={permalink} className="hover:underline">
              <RelativeTime value={comment.createdAt} />
            </Link>
            {comment.editedAt && !gone && (
              <span title={new Date(comment.editedAt).toLocaleString()}>
                · {t('interactions.edited')}
              </span>
            )}
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={!collapsed}
              aria-label={
                collapsed ? t('interactions.expandThread') : t('interactions.collapseThread')
              }
              onClick={() => setCollapsed((v) => !v)}
            >
              {collapsed ? <PlusIcon className="size-3" /> : <MinusIcon className="size-3" />}
              {collapsed && comment.replyCount > 0 && (
                <span>{t('interactions.replyCount', { count: comment.replyCount })}</span>
              )}
            </button>
          </header>
          {!collapsed && (
            <div
              className={cn(
                'mt-1 space-y-1',
                focused && '-mx-2 rounded-xl bg-link/5 px-2 py-1 ring-1 ring-ring/30',
              )}
            >
              {editing ? (
                <Composer
                  initial={comment.body}
                  autoFocus
                  placeholder={t('interactions.editPlaceholder')}
                  submitLabel={t('interactions.save')}
                  onCancel={() => setEditing(false)}
                  onSubmit={async (body) => {
                    const updated = await api<Comment>(
                      endpoints.comment(comment.id),
                      jsonRequest('PATCH', { body }, csrfToken),
                    )
                    tree.update(comment.id, (c) => ({
                      ...c,
                      body: updated.body,
                      editedAt: updated.editedAt,
                    }))
                    setEditing(false)
                  }}
                />
              ) : gone ? (
                <p className="text-sm italic text-muted-foreground">
                  {comment.removed ? t('interactions.removedBody') : t('interactions.deletedBody')}
                </p>
              ) : (
                <CommentBody text={comment.body} />
              )}
              <div className="-ml-1.5 flex flex-wrap items-center gap-1 text-xs">
                <VoteControl
                  score={comment.score}
                  myVote={comment.myVote}
                  label={t('interactions.voteOnComment')}
                  disabled={gone && comment.myVote === 0}
                  onVote={(value: Vote) =>
                    api<VoteResult>(
                      endpoints.commentVote(comment.id),
                      jsonRequest('PUT', { value }, csrfToken),
                    )
                  }
                  onResult={(r) =>
                    tree.update(comment.id, (c) => ({ ...c, score: r.score, myVote: r.myVote }))
                  }
                />
                {!gone &&
                  (user ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      aria-expanded={replying}
                      onClick={() => setReplying((v) => !v)}
                    >
                      <ArrowBendUpLeftIcon />
                      {t('interactions.reply')}
                    </Button>
                  ) : (
                    <Link
                      to={loginPath(location)}
                      className={buttonVariants({ variant: 'ghost', size: 'xs' })}
                    >
                      <ArrowBendUpLeftIcon />
                      {t('interactions.reply')}
                    </Link>
                  ))}
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    const url = new URL(permalink, window.location.origin).href
                    navigator.clipboard?.writeText(url).then(
                      () => notify(t('interactions.linkCopied'), 'success'),
                      () => notify(url, 'info', t('interactions.share')),
                    )
                  }}
                >
                  <LinkSimpleIcon />
                  {t('interactions.share')}
                </Button>
                {own && !gone && !editing && (
                  <Button variant="ghost" size="xs" onClick={() => setEditing(true)}>
                    <PencilSimpleIcon />
                    {t('interactions.edit')}
                  </Button>
                )}
                {(own || canModerate) && !gone && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-destructive"
                    onClick={() => setConfirm(true)}
                  >
                    {canModerate ? <ShieldWarningIcon /> : <TrashIcon />}
                    {canModerate ? t('interactions.remove') : t('interactions.delete')}
                  </Button>
                )}
              </div>
              {replying && (
                <div className="pt-1">
                  <Composer
                    autoFocus
                    placeholder={t('interactions.replyPlaceholder', { author })}
                    submitLabel={t('interactions.reply')}
                    onCancel={() => setReplying(false)}
                    onSubmit={async (body) => {
                      const reply = await api<Comment>(
                        tree.subject.newComment,
                        jsonRequest('POST', { body, parentId: comment.id }, csrfToken),
                      )
                      tree.addReply(comment.id, reply)
                      setReplying(false)
                    }}
                  />
                </div>
              )}
            </div>
          )}
          {!collapsed &&
            (level >= maxVisibleDepth && comment.replyCount > 0 ? (
              <Link
                to={permalink}
                className="mt-2 inline-flex items-center gap-1 text-xs text-link hover:underline"
              >
                {t('interactions.continueThread')}
                <ArrowRightIcon className="size-3" />
              </Link>
            ) : (
              (comment.replies.length > 0 || hiddenReplies > 0) && (
                <div className="mt-3 space-y-4">
                  {comment.replies.map((reply) => (
                    <CommentNode key={reply.id} comment={reply} level={level + 1} />
                  ))}
                  {hiddenReplies > 0 && (
                    <Link
                      to={permalink}
                      className="inline-flex items-center gap-1 text-xs text-link hover:underline"
                    >
                      {t('interactions.moreReplies', { count: hiddenReplies })}
                      <ArrowRightIcon className="size-3" />
                    </Link>
                  )}
                </div>
              )
            ))}
        </div>
      </div>
      {confirm && (
        <Modal
          title={canModerate ? t('interactions.removeTitle') : t('interactions.deleteTitle')}
          busy={busy}
          onDismiss={() => setConfirm(false)}
          actions={
            <>
              <DialogClose render={<Button type="button" variant="outline" />} disabled={busy}>
                {t('messages.cancel')}
              </DialogClose>
              <Button type="button" variant="destructive" disabled={busy} onClick={remove}>
                {canModerate ? t('interactions.remove') : t('interactions.delete')}
              </Button>
            </>
          }
        >
          {canModerate ? t('interactions.removeExplanation') : t('interactions.deleteExplanation')}
        </Modal>
      )}
    </article>
  )
}

export function CommentSection({
  subject,
  focusId,
  onCountChange,
}: {
  subject: CommentSubject
  focusId?: string
  onCountChange: (delta: number) => void
}) {
  const { t } = useTranslation()
  const { user, csrfToken } = useSession()
  const location = useLocation()
  const [sort, setSort] = useState<CommentSort>('best')
  const [items, setItems] = useState<Comment[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const section = useRef<HTMLElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    setItems(null)
    setError('')
    setPage(1)
    const request = focusId
      ? api<CommentThread>(endpoints.commentThread(focusId, sort), {
          signal: controller.signal,
        }).then((r) => ({ items: [r.item], total: 1 }))
      : api<CommentPage>(subject.comments({ sort, page: 1 }), {
          signal: controller.signal,
        })
    request
      .then((r) => {
        if (controller.signal.aborted) return
        setItems(r.items)
        setTotal(r.total)
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
    // The subject's identity is its path; its callbacks are rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject.path, focusId, sort, attempt])
  useEffect(() => {
    if (location.hash === '#comments') section.current?.scrollIntoView()
  }, [location.hash])
  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const next = await api<CommentPage>(subject.comments({ sort, page: page + 1 }))
      // Comments posted meanwhile can shift pages; skip what is already shown.
      setItems((current) => {
        const seen = new Set(current?.map((c) => c.id))
        return [...(current ?? []), ...next.items.filter((c) => !seen.has(c.id))]
      })
      setTotal(next.total)
      setPage(page + 1)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingMore(false)
    }
  }
  const tree: Tree = {
    subject,
    focusId,
    update: (id, change) => setItems((current) => current && mapTree(current, id, change)),
    addReply: (parentId, reply) => {
      setItems(
        (current) =>
          current &&
          mapTree(current, parentId, (c) => ({
            ...c,
            replyCount: c.replyCount + 1,
            replies: [reply, ...c.replies],
          })),
      )
      onCountChange(1)
    },
    remove: (id, purged, removed) => {
      if (!purged) {
        setItems(
          (current) =>
            current &&
            mapTree(current, id, (c) => ({
              ...c,
              body: '',
              author: '',
              authorId: '',
              authorAvatarUrl: '',
              deleted: !removed,
              removed,
            })),
        )
        return
      }
      if (!items) return
      const next = purge(items, id)
      setItems(next)
      setTotal((n) => n - (items.length - next.length))
      onCountChange(countTree(next) - countTree(items))
    },
  }
  const sorts: { value: CommentSort; label: string }[] = [
    { value: 'best', label: t('interactions.sortBest') },
    { value: 'top', label: t('interactions.sortTop') },
    { value: 'new', label: t('interactions.sortNew') },
    { value: 'old', label: t('interactions.sortOld') },
    { value: 'controversial', label: t('interactions.sortControversial') },
  ]
  return (
    <section
      ref={section}
      id="comments"
      aria-labelledby="comments-heading"
      className="scroll-mt-24 space-y-6 rounded-[14px] border-2 border-outline bg-card p-6 shadow-drop sm:p-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="comments-heading"
          className="flex shrink-0 items-center gap-2 text-xl font-extrabold whitespace-nowrap"
        >
          <ChatCircleIcon aria-hidden="true" />
          {t('interactions.commentsHeading', { count: subject.commentCount })}
        </h2>
        <div className="shrink-0">
          <ChoiceSelect
            label={t('interactions.sortComments')}
            value={sort}
            items={sorts}
            onValueChange={(value) => setSort(value as CommentSort)}
          />
        </div>
      </div>
      {focusId ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-muted px-4 py-3 text-sm">
          <span className="text-muted-foreground">{t('interactions.singleThread')}</span>
          <Link to={`${subject.path}#comments`} className="text-link hover:underline">
            {t('interactions.viewAllComments')}
          </Link>
          {items?.[0]?.parentId && (
            <Link
              to={subject.commentPath(items[0].parentId)}
              className="text-link hover:underline"
            >
              {t('interactions.viewParent')}
            </Link>
          )}
        </div>
      ) : user ? (
        <Composer
          placeholder={t(subject.placeholder)}
          submitLabel={t('interactions.comment')}
          onSubmit={async (body) => {
            const created = await api<Comment>(
              subject.newComment,
              jsonRequest('POST', { body }, csrfToken),
            )
            setItems((current) => [created, ...(current ?? [])])
            setTotal((n) => n + 1)
            onCountChange(1)
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted px-4 py-3 text-sm">
          <span className="text-muted-foreground">{t('interactions.signInToComment')}</span>
          <Link to={loginPath(location)} className={buttonVariants({ size: 'sm' })}>
            {t('messages.signInRegister')}
          </Link>
        </div>
      )}
      {error ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Notice>{error}</Notice>
          <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
            {t('messages.retry')}
          </Button>
        </div>
      ) : !items ? (
        <div className="space-y-4" role="status" aria-label={t('interactions.loadingComments')}>
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t('interactions.noComments')}
        </p>
      ) : (
        <TreeContext.Provider value={tree}>
          <div className="space-y-6">
            {items.map((comment) => (
              <CommentNode key={comment.id} comment={comment} level={0} />
            ))}
          </div>
        </TreeContext.Provider>
      )}
      {!focusId && items && items.length < total && (
        <div className="flex justify-center">
          <Button variant="outline" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? t('interactions.loadingComments') : t('interactions.loadMoreComments')}
          </Button>
        </div>
      )}
    </section>
  )
}

// A flat comment with the song it belongs to, for a user's history.
function CommentSummary({ comment }: { comment: Comment }) {
  const { t, i18n } = useTranslation()
  const subjectTitle = comment.danId
    ? danTitle(comment.danTitle ?? {}, i18n.resolvedLanguage)
    : comment.chartTitle
  return (
    <article className="min-w-0 space-y-2 rounded-[14px] border p-4">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <Link
          to={`/users/${encodeURIComponent(comment.authorId)}`}
          className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline"
        >
          <UserAvatar
            nickname={comment.author || t('messages.unknownMember')}
            avatarUrl={comment.authorAvatarUrl}
            className="size-5"
            fallbackClassName="text-[10px]"
          />
          {comment.author || t('messages.unknownMember')}
        </Link>
        <span aria-hidden="true">·</span>
        <Link to={commentSubjectPath(comment)} className="max-w-60 truncate hover:underline">
          {subjectTitle}
        </Link>
        <span aria-hidden="true">·</span>
        <RelativeTime value={comment.createdAt} />
      </header>
      <CommentBody text={comment.body} />
      <footer className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="tabular-nums">{t('interactions.points', { count: comment.score })}</span>
        <Link to={commentPermalink(comment)} className="text-link hover:underline">
          {t('interactions.viewInContext')}
        </Link>
      </footer>
    </article>
  )
}

// Pages a flat comment list such as a user's history.
export function CommentListView({
  load,
  empty,
}: {
  load: (page: number, signal: AbortSignal) => Promise<CommentList>
  empty: string
}) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [data, setData] = useState<CommentList | null>(null)
  const [error, setError] = useState('')
  const loader = useRef(load)
  loader.current = load
  useEffect(() => {
    const controller = new AbortController()
    setData(null)
    setError('')
    loader
      .current(page, controller.signal)
      .then((r) => {
        if (controller.signal.aborted) return
        setData(r)
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [page])
  if (error) return <Notice>{error}</Notice>
  if (!data)
    return (
      <div className="space-y-3" role="status" aria-label={t('interactions.loadingComments')}>
        <Skeleton className="h-24 rounded-[14px]" />
        <Skeleton className="h-24 rounded-[14px]" />
      </div>
    )
  if (data.items.length === 0)
    return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize))
  return (
    <div className="space-y-3">
      {data.items.map((comment) => (
        <CommentSummary key={comment.id} comment={comment} />
      ))}
      {pages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-4 pt-2 text-sm">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>
            {t('messages.previous')}
          </Button>
          <span>{t('messages.pagination', { page, pages })}</span>
          <Button variant="outline" disabled={page >= pages} onClick={() => setPage((n) => n + 1)}>
            {t('messages.next')}
          </Button>
        </div>
      )}
    </div>
  )
}
