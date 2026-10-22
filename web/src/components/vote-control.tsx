import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowFatDownIcon, ArrowFatUpIcon } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { formatLocale } from '@/i18n'
import { useSession } from '@/session-context'
import { useNotification } from '@/notification-context'
import type { Vote, VoteResult } from '@/api/types'

export function compactNumber(value: number, language: string) {
  return new Intl.NumberFormat(formatLocale(language), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export function loginPath(location: { pathname: string; search: string; hash: string }) {
  return `/login?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`
}

// Reddit-style arrows. Pressing the active arrow withdraws the vote. The score
// updates immediately and rolls back if the server rejects the vote.
export function VoteControl({
  score,
  myVote,
  onVote,
  onResult,
  label,
  layout = 'horizontal',
  disabled = false,
  className,
}: {
  score: number
  myVote: Vote
  onVote: (value: Vote) => Promise<VoteResult>
  onResult: (result: VoteResult) => void
  label: string
  layout?: 'horizontal' | 'vertical'
  disabled?: boolean
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const { user } = useSession()
  const { notify } = useNotification()
  const navigate = useNavigate()
  const location = useLocation()
  const [pending, setPending] = useState<{ score: number; myVote: Vote } | null>(null)
  const shown = pending ?? { score, myVote }
  const cast = async (direction: 1 | -1) => {
    if (!user) {
      navigate(loginPath(location))
      return
    }
    if (pending) return
    const next: Vote = shown.myVote === direction ? 0 : direction
    setPending({ score: score - myVote + next, myVote: next })
    try {
      onResult(await onVote(next))
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setPending(null)
    }
  }
  const arrow =
    'inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:bg-muted active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100'
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5',
        layout === 'vertical' && 'flex-col',
        className,
      )}
    >
      <button
        type="button"
        className={cn(arrow, shown.myVote === 1 && 'text-[#ff4500] hover:text-[#ff4500]')}
        aria-pressed={shown.myVote === 1}
        aria-label={t('interactions.upvote')}
        title={t('interactions.upvote')}
        disabled={disabled}
        onClick={() => void cast(1)}
      >
        <ArrowFatUpIcon className="size-4" weight={shown.myVote === 1 ? 'fill' : 'bold'} />
      </button>
      <span
        className={cn(
          'min-w-6 text-center text-sm font-semibold tabular-nums',
          shown.myVote === 1 && 'text-[#ff4500]',
          shown.myVote === -1 && 'text-[#0071e3]',
        )}
        aria-live="polite"
        title={t('interactions.scoreExact', { score: shown.score })}
      >
        <span className="sr-only">{t('interactions.score')}</span>
        {compactNumber(shown.score, i18n.language)}
      </span>
      <button
        type="button"
        className={cn(arrow, shown.myVote === -1 && 'text-[#0071e3] hover:text-[#0071e3]')}
        aria-pressed={shown.myVote === -1}
        aria-label={t('interactions.downvote')}
        title={t('interactions.downvote')}
        disabled={disabled}
        onClick={() => void cast(-1)}
      >
        <ArrowFatDownIcon className="size-4" weight={shown.myVote === -1 ? 'fill' : 'bold'} />
      </button>
    </div>
  )
}
