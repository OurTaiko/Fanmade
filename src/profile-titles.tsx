import { useEffect, useState } from 'react'
import { PROFILE_URL } from '@/components/profile-plate'
import { normalizeLanguage } from '@/i18n'
import { cn } from '@/lib/utils'

// The title catalog of OurTaikoProfile (profile.ourtaiko.org), which 段位 courses give titles
// from. A course may give official titles (once it is official itself), its maker's own
// community titles, and the community titles Profile's administrators keep (no maker).

export type TitleStyle = 'wood' | 'teal' | 'wood2' | 'purple' | 'gold' | 'rainbow'
export type ProfileTitle = {
  id: string
  name: string
  nameTranslations: Record<string, string>
  description: string
  style: TitleStyle
  official: boolean
  ownerId: string | null
}

const bands: Record<TitleStyle, string> = {
  wood: 'bg-linear-to-b from-[#a8743f] to-[#6e4420]',
  teal: 'bg-linear-to-b from-[#3fb6b2] to-[#1d6f73]',
  wood2: 'bg-linear-to-b from-[#d6a46a] to-[#9a6430]',
  purple: 'bg-linear-to-b from-[#9b6ad6] to-[#5b2f93]',
  gold: 'bg-linear-to-b from-[#f7d774] to-[#b8860b]',
  rainbow: 'bg-[linear-gradient(90deg,#ff5f6d,#ffc371,#fff66d,#6dff9c,#5fc8ff,#a06dff)]',
}

export const profileTitlesPage = `${PROFILE_URL}/titles`

let catalog: Promise<ProfileTitle[]> | null = null

async function readCatalog(): Promise<ProfileTitle[]> {
  const response = await fetch(`${PROFILE_URL}/api/v1/titles`)
  if (!response.ok) throw new Error(String(response.status))
  return ((await response.json()) as { titles: ProfileTitle[] }).titles
}

// The catalog, read once per page load; fresh reads it again (after making a title on Profile).
export function useProfileTitles() {
  const [titles, setTitles] = useState<ProfileTitle[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let live = true
    if (!catalog || revision > 0) catalog = readCatalog()
    const reading = catalog
    reading.then(
      (found) => {
        if (!live) return
        setTitles(found)
        setFailed(false)
      },
      () => {
        if (catalog === reading) catalog = null
        if (live) setFailed(true)
      },
    )
    return () => {
      live = false
    }
  }, [revision])
  return { titles, failed, reload: () => setRevision((r) => r + 1) }
}

// Whether a course made by owner can give the title (official ones once it is official).
export function titleUsableBy(title: ProfileTitle, owner: string) {
  return title.official || title.ownerId === null || title.ownerId === owner
}

// The title's name in the page's language, else its own.
export function titleText(title: ProfileTitle, language?: string) {
  return title.nameTranslations?.[normalizeLanguage(language)] || title.name
}

// The title as the nameplate's band shows it.
export function TitleBand({
  title,
  language,
  className,
}: {
  title: ProfileTitle
  language?: string
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-block max-w-full truncate rounded-md px-2.5 py-0.5 text-sm font-bold text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]',
        bands[title.style] ?? bands.wood,
        className,
      )}
    >
      {titleText(title, language)}
    </span>
  )
}
