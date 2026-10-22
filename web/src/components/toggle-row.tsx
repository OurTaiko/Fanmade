import type { ReactNode } from 'react'
import { CheckIcon } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

// One row of a pick list: the whole row toggles, and its right side tells
// whether it is currently picked (`pressedLabel`) or not (`idleLabel`).
export function ToggleRow({
  title,
  detail,
  pressed,
  pressedLabel,
  idleLabel,
  disabled = false,
  onToggle,
}: {
  title: string
  detail: ReactNode
  pressed: boolean
  pressedLabel: string
  idleLabel?: ReactNode
  disabled?: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={pressed}
      onClick={onToggle}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border p-3 text-left active:scale-[0.98] disabled:opacity-50',
        pressed ? 'border-primary bg-primary/5' : 'border-transparent bg-muted/40',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate" title={title}>
          {title}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{detail}</span>
      </span>
      <span
        className={cn(
          'flex shrink-0 items-center gap-1 text-xs whitespace-nowrap',
          pressed ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        {pressed ? (
          <>
            <CheckIcon className="size-3.5 shrink-0" aria-hidden="true" />
            {pressedLabel}
          </>
        ) : (
          idleLabel
        )}
      </span>
    </button>
  )
}
