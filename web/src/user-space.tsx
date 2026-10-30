import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeftIcon, ArrowClockwiseIcon } from '@phosphor-icons/react'
import { api } from '@sitekit/api/client'
import { endpoints } from '@/api/endpoints'
import type { UserSpace } from '@/api/types'
import { PublicUserCard } from '@/components/public-user-card'
import { ProfilePlate, profilePage } from '@sitekit/components/profile-plate'
import { Button, buttonVariants } from '@sitekit/components/ui/button'
import { Skeleton } from '@sitekit/components/ui/skeleton'
import { Library } from '@/pages'
import { Card } from '@sitekit/components/ui/card'
import { useSession } from '@/session-context'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@sitekit/components/ui/tabs'
import { ChoiceSelect } from '@sitekit/components/choice-select'
import { CommentListView } from '@/comments'
import type { CommentList } from '@/api/types'
import { UserPlaylists } from '@/playlists'

export function UserSpacePage() {
  const { id = '' } = useParams()
  const { t } = useTranslation()
  const session = useSession()
  const [data, setData] = useState<UserSpace | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    window.scrollTo(0, 0)
    const controller = new AbortController()
    setLoading(true)
    setError('')
    api<UserSpace>(endpoints.user(id), { signal: controller.signal })
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
  }, [id, refresh])
  const current = data?.user.id === id ? data : null
  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/users"
          className="inline-flex items-center gap-2 text-sm text-link hover:underline"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4 shrink-0" />
          {t('messages.backToUserSquare')}
        </Link>
        {session.user?.id === id && (
          <Link to="/me/profile" className={buttonVariants({ variant: 'outline' })}>
            {t('messages.manageMyAccount')}
          </Link>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="min-w-0 break-words text-3xl font-extrabold sm:text-4xl">
          {current && !loading && !error
            ? t('messages.memberSpaceTitle', {
                nickname: current.user.nickname ?? t('messages.unknownMember'),
              })
            : t('messages.userSpace')}
        </h1>
        <Button variant="outline" disabled={loading} onClick={() => setRefresh((n) => n + 1)}>
          <ArrowClockwiseIcon aria-hidden="true" />
          {t('messages.refreshUsers')}
        </Button>
      </div>
      {error ? (
        <Card role="alert" className="border-destructive p-6 text-destructive shadow-none">
          {error}
        </Card>
      ) : loading || !current ? (
        <div
          className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]"
          role="status"
          aria-label={t('messages.loadingMembers')}
        >
          <Skeleton className="h-96 rounded-[14px]" />
          <Skeleton className="h-96 rounded-[14px]" />
        </div>
      ) : (
        <>
          {!current.profilesAvailable && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('messages.memberNamesUnavailable')}
            </p>
          )}
          <div className="grid items-start gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <aside className="min-w-0 space-y-4" aria-label={t('messages.publicMemberDetails')}>
              <PublicUserCard user={current.user} showSpaceLink={false} />
              <ProfilePlate userId={id} />
              <a
                href={profilePage(id)}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: 'outline', className: 'w-full' })}
              >
                {t('ourtaikoProfile.view')}
              </a>
            </aside>
            <Tabs defaultValue="charts" className="min-w-0 gap-6">
              <TabsList aria-label={t('interactions.userSpaceSections')}>
                <TabsTrigger value="charts">{t('messages.publicChartCount')}</TabsTrigger>
                <TabsTrigger value="playlists">{t('playlists.userPlaylists')}</TabsTrigger>
                <TabsTrigger value="comments">{t('interactions.publicCommentCount')}</TabsTrigger>
              </TabsList>
              <TabsContent value="charts">
                <section
                  className="min-w-0 space-y-6"
                  aria-label={t('messages.userPublishedCharts')}
                >
                  <Library key={`${id}:${refresh}`} ownerId={id} embedded />
                </section>
              </TabsContent>
              <TabsContent value="playlists">
                <UserPlaylists key={`${id}:${refresh}`} ownerId={id} />
              </TabsContent>
              <TabsContent value="comments">
                <UserComments key={`${id}:${refresh}`} id={id} />
              </TabsContent>
            </Tabs>
          </div>
        </>
      )}
    </section>
  )
}

function UserComments({ id }: { id: string }) {
  const { t } = useTranslation()
  const [sort, setSort] = useState('new')
  return (
    <section className="min-w-0 space-y-4" aria-label={t('interactions.publicCommentCount')}>
      <div className="flex justify-end">
        <ChoiceSelect
          label={t('interactions.sortComments')}
          value={sort}
          items={[
            { value: 'new', label: t('interactions.sortNew') },
            { value: 'top', label: t('interactions.sortTop') },
          ]}
          onValueChange={setSort}
        />
      </div>
      <CommentListView
        key={sort}
        empty={t('interactions.noUserComments')}
        load={(page, signal) =>
          api<CommentList>(endpoints.userComments(id, { sort, page }), { signal })
        }
      />
    </section>
  )
}
