import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StarIcon } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { difficultyColors } from '@/components/difficulty-badges'
import { courseNames, slotKey } from './courses'
import type { Difficulty, DifficultyConstants as Constants } from './tja'

// The difficulty constants (定数) of the chosen block: its main constant, the 75 and 99
// sub-constants and the five dimensions as a radar, all on the server's 0–15.5 scale. A
// branching block shows its master route first and can switch to the others.

const maxValue = 15.5
const dimensions = ['stamina', 'handspeed', 'burst', 'complex', 'rhythm'] as const
type Dimension = (typeof dimensions)[number]

const format = (value: number) => value.toFixed(1)

export function DifficultyConstants({
  difficulty,
  className,
}: {
  difficulty: Difficulty | undefined
  className?: string
}) {
  const { t } = useTranslation()
  const heading = useId()
  const routes = difficulty?.constants ?? []
  const [chosen, setChosen] = useState('master')
  const shown =
    routes.find((r) => r.route === chosen) ?? routes.find((r) => r.route === 'master') ?? routes[0]
  const routeNames: Record<string, string> = {
    normal: t('constants.normal'),
    expert: t('constants.expert'),
    master: t('constants.master'),
  }
  return (
    <section
      aria-labelledby={heading}
      className={cn(
        '@container rounded-[14px] border-2 border-outline bg-card p-5 shadow-drop sm:p-6',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={heading} className="text-lg font-extrabold">
          {t('constants.title')}
        </h2>
        {difficulty && (
          <span
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-[7px] border-[1.5px] border-[#382d2a] px-2.5 text-xs font-bold whitespace-nowrap text-[#382d2a]',
              difficultyColors[difficulty.course as keyof typeof difficultyColors] ?? 'bg-muted',
            )}
          >
            {courseNames[slotKey(difficulty) as keyof typeof courseNames]}
            <span className="inline-flex items-center gap-0.5 tabular-nums">
              <StarIcon weight="fill" className="size-3" aria-hidden="true" />
              {difficulty.level}
            </span>
          </span>
        )}
      </div>
      {!shown ? (
        <p className="mt-4 text-sm text-muted-foreground">{t('constants.unavailable')}</p>
      ) : (
        <>
          {routes.length > 1 && (
            <div
              role="radiogroup"
              aria-label={t('messages.selectBranch')}
              className="mt-4 grid grid-cols-3 overflow-hidden rounded-[10px] border-2 border-outline bg-card"
            >
              {routes.map((r) => (
                <button
                  key={r.route}
                  type="button"
                  role="radio"
                  aria-checked={r.route === shown.route}
                  onClick={() => setChosen(r.route)}
                  className={cn(
                    'h-9 min-w-0 truncate px-2 text-sm font-bold text-muted-foreground transition-colors not-first:border-l not-first:border-l-border hover:bg-muted/50 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    r.route === shown.route && 'bg-muted text-foreground',
                  )}
                >
                  {routeNames[r.route] ?? r.route}
                </button>
              ))}
            </div>
          )}
          <div className="mt-4 flex flex-col gap-4 @lg:flex-row @lg:items-center">
            <ConstantValues values={shown} />
            <Radar
              values={shown}
              className="mx-auto w-full max-w-[17rem] @lg:max-w-[19rem] @lg:flex-1"
            />
          </div>
        </>
      )}
    </section>
  )
}

function ConstantValues({ values }: { values: Constants }) {
  const { t } = useTranslation()
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-4 rounded-[10px] border-[1.5px] border-border bg-cream p-4 @lg:w-56 @lg:shrink-0 @lg:grid-cols-1 @lg:gap-y-4">
      <div>
        <dt className="text-xs font-bold text-muted-foreground">{t('constants.main')}</dt>
        <dd className="mt-1 text-5xl leading-none font-extrabold tabular-nums">
          {format(values.mainConstant)}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-bold text-muted-foreground">{t('constants.sub')}</dt>
        <dd className="mt-1.5 flex gap-3 text-sm tabular-nums">
          <span>
            <span className="mr-1 text-xs text-muted-foreground">75</span>
            <span className="font-bold">{format(values.subConstant75)}</span>
          </span>
          <span>
            <span className="mr-1 text-xs text-muted-foreground">99</span>
            <span className="font-bold">{format(values.subConstant99)}</span>
          </span>
        </dd>
      </div>
    </dl>
  )
}

// A pentagon per quarter of the scale, the five axes from the top clockwise, and the block's
// values as the filled shape; each axis is labelled with its name and value.
function Radar({ values, className }: { values: Constants; className?: string }) {
  const { t } = useTranslation()
  const width = 280,
    height = 252,
    cx = width / 2,
    cy = 132,
    radius = 82
  const point = (index: number, fraction: number) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / dimensions.length
    return [
      cx + Math.cos(angle) * radius * fraction,
      cy + Math.sin(angle) * radius * fraction,
    ] as const
  }
  const polygon = (fractions: number[]) =>
    fractions
      .map((f, i) =>
        point(i, f)
          .map((n) => n.toFixed(1))
          .join(','),
      )
      .join(' ')
  const fraction = (d: Dimension) => Math.min(Math.max(values[d] / maxValue, 0), 1)
  const names: Record<Dimension, string> = {
    stamina: t('constants.stamina'),
    handspeed: t('constants.handspeed'),
    burst: t('constants.burst'),
    complex: t('constants.complex'),
    rhythm: t('constants.rhythm'),
  }
  return (
    <figure className={className}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={dimensions.map((d) => `${names[d]} ${format(values[d])}`).join(', ')}
        className="h-auto w-full overflow-visible"
      >
        {[0.25, 0.5, 0.75, 1].map((ring) => (
          <polygon
            key={ring}
            points={polygon(dimensions.map(() => ring))}
            className={cn('fill-none stroke-border', ring === 1 ? 'stroke-[2]' : 'stroke-[1.5]')}
          />
        ))}
        {dimensions.map((d, i) => {
          const [x, y] = point(i, 1)
          return (
            <line key={d} x1={cx} y1={cy} x2={x} y2={y} className="stroke-border stroke-[1.5]" />
          )
        })}
        <polygon
          points={polygon(dimensions.map(fraction))}
          className="fill-primary/25 stroke-primary stroke-[2.5] [stroke-linejoin:round]"
        />
        {/* Vertex dots, except near the centre where they would only pile up. */}
        {dimensions.map((d, i) => {
          if (fraction(d) < 0.03) return null
          const [x, y] = point(i, fraction(d))
          return (
            <circle key={d} cx={x} cy={y} r={4} className="fill-card stroke-outline stroke-[2]" />
          )
        })}
        {dimensions.map((d, i) => {
          const [x, y] = point(i, 1.22)
          const anchor = Math.abs(x - cx) < 4 ? 'middle' : x > cx ? 'start' : 'end'
          const top = i === 0
          return (
            <text
              key={d}
              x={x}
              y={top ? y - 14 : y - 4}
              textAnchor={anchor}
              className="fill-foreground"
            >
              <tspan x={x} className="fill-muted-foreground text-[12px] font-bold">
                {names[d]}
              </tspan>
              <tspan x={x} dy={16} className="text-[14px] font-extrabold tabular-nums">
                {format(values[d])}
              </tspan>
            </text>
          )
        })}
      </svg>
    </figure>
  )
}
