import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRightIcon } from '@phosphor-icons/react'
import type { PublicUser } from '@/api/types'
import { UserAvatar } from '@/components/user-avatar'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatLocale } from '@/i18n'

export function PublicUserCard({
  user,
  showSpaceLink = true,
}: {
  user: PublicUser
  showSpaceLink?: boolean
}) {
  const { t, i18n } = useTranslation()
  const nickname = user.nickname ?? t('messages.unknownMember')
  const date = (value: string | null) =>
    value ? (
      <time dateTime={value}>
        {new Intl.DateTimeFormat(formatLocale(i18n.language), {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(value))}
      </time>
    ) : (
      t('messages.noActivityRecord')
    )
  return (
    <Card className="h-full min-w-0 gap-6 rounded-2xl border p-6 shadow-none ring-0 sm:p-7">
      <div className="flex min-w-0 items-center gap-4">
        <UserAvatar
          nickname={nickname}
          avatarUrl={user.avatarUrl}
          className="size-12 shrink-0"
          fallbackClassName="text-lg"
        />
        <h2 className="min-w-0 break-words text-lg font-semibold tracking-tight">{nickname}</h2>
      </div>
      <p className="break-all font-mono text-xs leading-relaxed text-muted-foreground">
        <span className="mr-2">ID</span>
        {user.id}
      </p>
      <dl className="grid grid-cols-2 gap-4 border-y py-5">
        <div>
          <dt className="text-sm text-muted-foreground">{t('messages.publicChartCount')}</dt>
          <dd className="mt-2 text-2xl font-semibold tabular-nums">
            {user.chartCount.toLocaleString(formatLocale(i18n.language))}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t('messages.publicScoreCount')}</dt>
          <dd className="mt-2 text-2xl font-semibold tabular-nums">
            {user.scoreCount.toLocaleString(formatLocale(i18n.language))}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t('interactions.publicCommentCount')}</dt>
          <dd className="mt-2 text-2xl font-semibold tabular-nums">
            {user.commentCount.toLocaleString(formatLocale(i18n.language))}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground" title={t('interactions.karmaExplanation')}>
            {t('interactions.karma')}
          </dt>
          <dd className="mt-2 text-2xl font-semibold tabular-nums">
            {user.karma.toLocaleString(formatLocale(i18n.language))}
          </dd>
        </div>
      </dl>
      <dl className="space-y-3 text-sm">
        <div className="space-y-1">
          <dt className="text-muted-foreground">{t('messages.firstFanmadeLogin')}</dt>
          <dd>{date(user.firstLoginAt)}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground">{t('messages.lastFanmadeActivity')}</dt>
          <dd>{date(user.lastActiveAt)}</dd>
        </div>
      </dl>
      {showSpaceLink && (
        <Link
          to={`/users/${encodeURIComponent(user.id)}`}
          aria-label={t('messages.visitMemberSpace', { nickname })}
          className={buttonVariants({
            variant: 'outline',
            className:
              'mt-auto w-full rounded-full active:scale-[0.98] motion-reduce:transform-none',
          })}
        >
          {t('messages.visitUserSpace')}
          <ArrowRightIcon aria-hidden="true" />
        </Link>
      )}
    </Card>
  )
}
