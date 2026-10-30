import { useTranslation } from 'react-i18next'
import { StarIcon } from '@phosphor-icons/react'
import { Badge } from '@sitekit/components/ui/badge'
import { cn } from '@sitekit/lib/utils'
import type { Difficulty } from '@/tja'
import {
  courseNames,
  isSupportedCourse,
  slotKey,
  groupCourses,
  groupLevel,
  groupName,
} from '@/courses'

// Fixed course colours, dark text on both themes (AA on every swatch).
export const difficultyColors = {
  Easy: 'bg-[#f9a15a]',
  Normal: 'bg-[#8fd16a]',
  Hard: 'bg-[#6cc7d8]',
  Oni: 'bg-[#f77fab]',
  Edit: 'bg-[#b99ae8]',
}

const swatch =
  'inline-flex items-center gap-1.5 border-[1.5px] border-[#382d2a] rounded-[7px] font-bold text-[#382d2a] text-xs whitespace-nowrap'

export function DifficultyBadges({
  difficulties,
  detailed = false,
  bookmarks = false,
}: {
  difficulties: Difficulty[]
  detailed?: boolean
  bookmarks?: boolean
}) {
  const { t } = useTranslation()

  const supported = difficulties.filter((d) => isSupportedCourse(slotKey(d)))
  const items = detailed
    ? supported
    : supported.filter(
        (d, index, all) => all.findIndex((other) => slotKey(other) === slotKey(d)) === index,
      )
  // Bookmarks show the single, P1 and P2 blocks of one course as one chart, so
  // a song has at most five and they fit the fixed card height.
  if (bookmarks)
    return (
      <ul
        aria-label={t('messages.chartDifficulty')}
        className="flex flex-col self-start gap-1.5 w-max min-w-24 shrink-0 whitespace-nowrap"
      >
        {groupCourses(difficulties).map((group) => (
          <li
            key={group.base}
            className={cn(
              swatch,
              'justify-between px-2.5 h-7',
              difficultyColors[group.base as keyof typeof difficultyColors] ?? 'bg-muted',
            )}
          >
            <span>{groupName(group)}</span>
            <span
              className="inline-flex items-center gap-0.5 tabular-nums"
              aria-label={group.sides
                .map((side) => t('common.stars', { count: side.level }))
                .filter((label, index, all) => all.indexOf(label) === index)
                .join(' / ')}
            >
              <StarIcon weight="fill" className="size-3" aria-hidden="true" />
              {groupLevel(group)}
            </span>
          </li>
        ))}
      </ul>
    )
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((d) => (
        <Badge
          className={cn(swatch, 'h-6 px-2', difficultyColors[d.course as keyof typeof difficultyColors])}
          key={slotKey(d)}
        >
          {courseNames[slotKey(d) as keyof typeof courseNames]}
          <span
            className="inline-flex items-center gap-1 tabular-nums"
            aria-label={t('common.stars', { count: d.level })}
          >
            <StarIcon weight="fill" className="size-3" aria-hidden="true" />
            {d.level}
          </span>
        </Badge>
      ))}
    </div>
  )
}
