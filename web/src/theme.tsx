import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { MoonIcon as Moon, SunIcon as Sun, MonitorIcon as Monitor } from '@phosphor-icons/react'
import { ThemeContext } from './theme-context'
import type { Theme } from './theme-context'
import { useTheme } from './theme-context'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('fanmade-theme')
      return saved === 'light' || saved === 'dark' ? saved : 'system'
    } catch {
      return 'system'
    }
  })
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.classList.toggle('scheme-dark', dark)
      document.documentElement.classList.toggle('scheme-light', !dark)
      const color = getComputedStyle(document.documentElement)
        .getPropertyValue('--background')
        .trim()
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
    }
    apply()
    media.addEventListener('change', apply)
    try {
      localStorage.setItem('fanmade-theme', theme)
    } catch {
      /* Storage may be unavailable. */
    }
    return () => media.removeEventListener('change', apply)
  }, [theme])
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== 'fanmade-theme') return
      setTheme(event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : 'system')
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

export function ThemeToggle() {
  const { t } = useTranslation()

  const { theme, setTheme } = useTheme()
  const Icon = theme === 'system' ? Monitor : theme === 'dark' ? Moon : Sun
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label={t('messages.changeColorTheme')} />}
      >
        <Icon className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          <DropdownMenuRadioItem value="light">
            <Sun />
            {t('messages.light')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon />
            {t('messages.dark')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor />
            {t('messages.system')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
