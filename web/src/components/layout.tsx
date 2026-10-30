import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet } from 'react-router-dom'
import {
  CompassIcon as Compass,
  UsersIcon,
  FolderIcon as FolderHeart,
  SignOutIcon as LogOut,
  SignInIcon,
  ListIcon as Menu,
  GameControllerIcon,
  PlaylistIcon,
  MedalIcon,
} from '@phosphor-icons/react'
import { useState } from 'react'
import { Notice } from '@sitekit/notifications'
import { useSession } from '@/session-context'
import { Button, buttonVariants } from '@sitekit/components/ui/button'
import { UserAvatar } from '@sitekit/components/user-avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@sitekit/components/ui/dropdown-menu'
import { cn } from '@sitekit/lib/utils'
import { ThemeToggle } from '@/theme'
import { NotificationBell } from '@/notification-center'

const navLinkClassName =
  'inline-flex items-center h-9 px-3 rounded-lg border-[1.5px] border-transparent text-sm whitespace-nowrap transition-colors hover:text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/40'

export function Layout() {
  const { t } = useTranslation()

  const session = useSession()
  const [error, setError] = useState('')
  const links = [
    { to: '/', label: t('messages.exploreCharts'), icon: Compass },
    { to: '/playlists', label: t('playlists.plaza'), icon: PlaylistIcon },
    { to: '/dans', label: t('dans.nav'), icon: MedalIcon },
    { to: '/users', label: t('messages.userSquare'), icon: UsersIcon },
    {
      to: 'https://play.ourtaiko.org/',
      label: t('messages.ourTaikoPlayer'),
      icon: GameControllerIcon,
    },
    { to: '/me/charts', label: t('messages.chartManager'), icon: FolderHeart },
  ]
  return (
    <div className="bg-background min-h-svh text-foreground">
      <header className="top-0 z-30 sticky bg-background/95 backdrop-blur-xl border-t-[5px] border-t-(--hero) border-b">
        <div className="flex items-center gap-4 mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl h-[4.25rem]">
          <Link className="flex items-center gap-2 font-extrabold text-xl shrink-0" to="/">
            <img src="/icons/icon-192.png" alt="" className="rounded-lg size-8" />
            <span>
              OurTaiko <span className="hidden sm:inline text-primary">Fanmade</span>
            </span>
          </Link>
          <nav
            className="hidden xl:flex items-center gap-1 ml-4"
            aria-label={t('messages.mainNavigation')}
          >
            {links.map(({ to, label }) =>
              to.startsWith('https://') ? (
                <a
                  key={to}
                  href={to}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={navLinkClassName}
                >
                  {label}
                </a>
              ) : (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    cn(
                      navLinkClassName,
                      isActive &&
                        'border-outline bg-secondary font-bold text-foreground hover:text-foreground shadow-[0_2px_0_var(--outline)]',
                    )
                  }
                >
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
              <Link
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                to="/login"
                aria-label={t('messages.signInRegister')}
              >
                <SignInIcon className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">{t('messages.signInRegister')}</span>
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
