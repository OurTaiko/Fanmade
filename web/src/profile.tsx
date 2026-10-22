import { useTranslation } from 'react-i18next'
import { languageNames, normalizeLanguage } from './i18n'
import { endpoints } from '@/api/endpoints'
import { UserAvatar } from '@/components/user-avatar'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Link } from 'react-router-dom'
import { ArrowUpRightIcon as ArrowUpRight } from '@phosphor-icons/react'
import { useSession } from './session-context'
import { Notice } from './notifications'

export function ProfilePage() {
  const { t } = useTranslation()

  const session = useSession()
  if (session.loading) return <p role="status">{t('messages.loadingProfile')}</p>
  if (!session.user)
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-dashed bg-card/60 px-6 py-16 text-center [&>p]:max-w-lg [&>p]:text-muted-foreground">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('messages.signInToViewYourProfile')}
        </h1>
        {session.error && <Notice>{session.error}</Notice>}
        <p>{t('messages.manageYourNicknameAndPasswordInTheOurtaikoAccountCenter')}</p>
        <Link
          className={buttonVariants({ variant: 'default', size: 'default' })}
          to="/login?returnTo=/me/profile"
        >
          {t('messages.signIn')}
        </Link>
      </div>
    )
  const user = session.user
  return (
    <>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center [&_p]:mt-2 [&_p]:text-sm [&_p]:text-muted-foreground">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t('messages.profile')}
          </h1>
          <p>{t('messages.yourOurtaikoAccountAlongsideYourCreations')}</p>
        </div>
      </div>
      {session.error && <Notice>{session.error}</Notice>}
      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card
          className="min-w-0 border p-5 shadow-none ring-0 sm:p-6 items-center text-center"
          aria-label={t('messages.publicNickname')}
        >
          <UserAvatar
            nickname={user.nickname}
            avatarUrl={user.avatarUrl}
            className="size-16"
            fallbackClassName="text-2xl"
          />
          <h2 className="text-base font-semibold">{user.nickname}</h2>
          <p className="text-sm text-muted-foreground">{t('messages.theNameOthersSee')}</p>
          <Link
            to={`/users/${encodeURIComponent(user.id)}`}
            className={buttonVariants({ variant: 'outline' })}
          >
            {t('messages.myUserSpace')}
          </Link>
        </Card>
        <Card
          className="min-w-0 border p-5 shadow-none ring-0 sm:p-6 gap-4"
          aria-label={t('messages.accountDetails')}
        >
          <Label htmlFor="profile-username">{t('messages.username')}</Label>
          <Input id="profile-username" value={user.username} readOnly />
          <Label htmlFor="profile-nickname">{t('messages.nickname')}</Label>
          <Input id="profile-nickname" value={user.nickname} readOnly />
          <Label htmlFor="profile-language">{t('messages.preferredLanguage')}</Label>
          <Input
            id="profile-language"
            value={languageNames[normalizeLanguage(user.preferredLanguage)]}
            readOnly
          />
          <p className="text-sm text-muted-foreground">
            {t('messages.manageLanguageNicknamePasswordAndDevicesInTheAccountCenterLanguageAnd')}
          </p>
          <a
            className={buttonVariants({ variant: 'default', size: 'default' })}
            href={endpoints.accountProfile}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('messages.manageOurtaikoAccount')}
            <ArrowUpRight size={17} />
          </a>
        </Card>
      </div>
    </>
  )
}
