import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet } from 'react-router-dom'
import {
  CompassIcon as Compass,
  UsersIcon,
  FolderIcon as FolderHeart,
  UploadSimpleIcon as Upload,
  SignOutIcon as LogOut,
  SignInIcon,
  UserIcon as UserRound,
  ListIcon as Menu,
  GameControllerIcon,
  PlaylistIcon,
} from '@phosphor-icons/react'
import { useState } from 'react'
import { Notice } from '@/notifications'
import { useSession } from '@/session-context'
import { Button, buttonVariants } from '@/components/ui/button'
import { UserAvatar } from '@/components/user-avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { ThemeToggle } from '@/theme'
import { NotificationBell } from '@/notification-center'
import pageBackground from '@/assets/page-background.webp'

export function Layout() {
  const { t } = useTranslation()

  const session = useSession()
  const [error, setError] = useState('')
  const links = [
    { to: '/', label: t('messages.exploreCharts'), icon: Compass },
    { to: '/playlists', label: t('playlists.plaza'), icon: PlaylistIcon },
    { to: '/users', label: t('messages.userSquare'), icon: UsersIcon },
    {
      to: 'https://play.ourtaiko.org/',
      label: t('messages.ourTaikoPlayer'),
      icon: GameControllerIcon,
    },
    { to: '/me/charts', label: t('messages.myCharts'), icon: FolderHeart },
    ...(session.user ? [{ to: '/me/profile', label: t('messages.profile'), icon: UserRound }] : []),
    { to: '/upload', label: t('messages.publishChart'), icon: Upload },
  ]
  return (
    <div className="isolate relative bg-background min-h-svh text-foreground">
      <div className="-z-10 fixed inset-0 pointer-events-none" aria-hidden="true">
        <img
          src={pageBackground}
          alt=""
          className="absolute inset-0 size-full object-center object-cover"
        />
        <div className="absolute inset-0 bg-linear-to-b from-background/55 dark:from-background/80 via-background/75 dark:via-background/90 to-background/95 dark:to-background/95" />
      </div>
      <header className="top-0 z-30 sticky bg-background/70 backdrop-blur-xl border-b">
        <div className="flex items-center gap-4 mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl h-16">
          <Link className="flex items-baseline gap-2 tracking-tight shrink-0" to="/">
            <span className="bg-clip-text bg-linear-to-r from-red-500 via-red-400 to-orange-400 font-bold text-transparent text-lg">
              OurTaiko
            </span>
            <span className="hidden sm:inline font-normal text-muted-foreground text-base">
              Fanmade
            </span>
          </Link>
          <nav
            className="hidden xl:flex items-center gap-1 ml-4"
            aria-label={t('messages.mainNavigation')}
          >
            {links.map(({ to, label, icon: Icon }) =>
              to.startsWith('https://') ? (
                <a
                  key={to}
                  href={to}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                >
                  <Icon className="opacity-60 size-4" aria-hidden="true" />
                  {label}
                </a>
              ) : (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    cn(buttonVariants({ variant: isActive ? 'secondary' : 'ghost', size: 'sm' }))
                  }
                >
                  <Icon className="opacity-60 size-4" aria-hidden="true" />
                  {label}
                </NavLink>
              ),
            )}
          </nav>
          <div className="flex items-center gap-2 ml-auto">
            <ThemeToggle />
            {session.loading ? (
              <span className="text-muted-foreground text-xs">{t('messages.connecting')}</span>
            ) : session.user ? (
              <>
                <NotificationBell />
                <Link
                  className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring max-w-40"
                  to="/me/profile"
                  aria-label={t('messages.openProfile')}
                >
                  <UserAvatar
                    nickname={session.user.nickname ?? ''}
                    avatarUrl={session.user.avatarUrl}
                  />
                  <span data-testid="account-nickname" className="hidden lg:block text-sm truncate">
                    {session.user.nickname}
                  </span>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('messages.signOut')}
                  onClick={() => {
                    setError('')
                    void session.logout().catch((e) => setError(e.message))
                  }}
                >
                  <LogOut className="size-4" aria-hidden="true" />
                </Button>
              </>
            ) : (
              <Link className={buttonVariants({ variant: 'ghost', size: 'sm' })} to="/login">
                <SignInIcon className="opacity-60 size-4" aria-hidden="true" />
                {t('messages.signInRegister')}
              </Link>
            )}
            <div className="xl:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon" aria-label={t('messages.openNavigation')} />
                  }
                >
                  <Menu className="size-4" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {links.map(({ to, label, icon: Icon }) => (
                    <DropdownMenuItem
                      key={to}
                      render={
                        to.startsWith('https://') ? (
                          <a href={to} target="_blank" rel="noopener noreferrer" />
                        ) : (
                          <Link to={to} />
                        )
                      }
                    >
                      <Icon className="opacity-60 size-4" aria-hidden="true" />
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>
      <main id="main" className="space-y-6 mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full max-w-7xl">
        {(session.error || error) && <Notice>{session.error || error}</Notice>}
        <Outlet />
      </main>
    </div>
  )
}
