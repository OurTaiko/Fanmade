import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

// The title and 段位 a player wears on OurTaikoProfile (profile.ourtaiko.org), drawn next to
// their name. Lookups for the names on a page are gathered into one request.
export const PROFILE_URL = (
  (import.meta.env.VITE_PROFILE_URL as string | undefined) || 'https://profile.ourtaiko.org'
).replace(/\/$/, '')
export const profilePage = (id: string) => `${PROFILE_URL}/users/${encodeURIComponent(id)}`

type Style = 'wood' | 'teal' | 'wood2' | 'purple' | 'gold' | 'rainbow'
type Plate = {
  title: { name: string; nameTranslations?: Record<string, string>; style: Style } | null
  dan: { index: number; gold: boolean } | null
}

const danNames = [
  '初級',
  '十級',
  '九級',
  '八級',
  '七級',
  '六級',
  '五級',
  '四級',
  '三級',
  '二級',
  '一級',
  '初段',
  '二段',
  '三段',
  '四段',
  '五段',
  '六段',
  '七段',
  '八段',
  '九段',
  '十段',
  '玄人',
  '名人',
  '超人',
  '達人',
]
const bands: Record<Style, string> = {
  wood: 'bg-linear-to-b from-[#a8743f] to-[#6e4420]',
  teal: 'bg-linear-to-b from-[#3fb6b2] to-[#1d6f73]',
  wood2: 'bg-linear-to-b from-[#d6a46a] to-[#9a6430]',
  purple: 'bg-linear-to-b from-[#9b6ad6] to-[#5b2f93]',
  gold: 'bg-linear-to-b from-[#f7d774] to-[#b8860b]',
  rainbow: 'bg-[linear-gradient(90deg,#ff5f6d,#ffc371,#fff66d,#6dff9c,#5fc8ff,#a06dff)]',
}

const plates = new Map<string, Promise<Plate | null>>()
let waiting: { id: string; resolve: (plate: Plate | null) => void }[] = []

async function flush() {
  const batch = waiting
  waiting = []
  for (let i = 0; i < batch.length; i += 100) {
    const part = batch.slice(i, i + 100)
    let found: Record<string, Plate> = {}
    try {
      const response = await fetch(
        `${PROFILE_URL}/api/v1/nameplates?ids=${part.map((p) => p.id).join(',')}`,
      )
      if (response.ok) found = (await response.json()).nameplates ?? {}
    } catch {
      // Profile unreachable: the names show without plates.
    }
    for (const p of part) p.resolve(found[p.id] ?? null)
  }
}

function plateOf(id: string): Promise<Plate | null> {
  let plate = plates.get(id)
  if (!plate) {
    plate = new Promise((resolve) => {
      if (waiting.length === 0) queueMicrotask(() => void flush())
      waiting.push({ id, resolve })
    })
    plates.set(id, plate)
  }
  return plate
}

export function ProfilePlate({ userId, className }: { userId: string; className?: string }) {
  const { i18n } = useTranslation()
  const [plate, setPlate] = useState<Plate | null>(null)
  useEffect(() => {
    let current = true
    void plateOf(userId).then((p) => current && setPlate(p))
    return () => {
      current = false
    }
  }, [userId])
  if (!plate || (!plate.title && !plate.dan)) return null
  const language = i18n.resolvedLanguage === 'zh-Hans' ? 'zh-Hans' : (i18n.resolvedLanguage ?? '')
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1 align-middle', className)}>
      {plate.dan && (
        <span
          className={cn(
            'inline-flex shrink-0 rounded-full px-1.5 py-0.5 text-[0.65rem] leading-none font-bold text-white',
            plate.dan.gold
              ? 'bg-linear-to-b from-amber-400 to-amber-600'
              : 'bg-linear-to-b from-red-500 to-red-700',
          )}
        >
          {danNames[plate.dan.index]}
        </span>
      )}
      {plate.title && (
        <span
          className={cn(
            'truncate rounded px-1.5 py-0.5 text-[0.7rem] leading-none font-bold text-white [text-shadow:0_1px_1px_rgb(0_0_0/0.6)]',
            bands[plate.title.style] ?? bands.wood,
          )}
        >
          {plate.title.nameTranslations?.[language] || plate.title.name}
        </span>
      )}
    </span>
  )
}
