import type { ReactNode } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export function ChoiceSelect({
  label,
  value,
  onValueChange,
  items,
  disabled = false,
  prefix,
}: {
  label: string
  value: string
  onValueChange: (value: string) => void
  items: { value: string; label: string; icon?: ReactNode }[]
  disabled?: boolean
  prefix?: ReactNode
}) {
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next)
      }}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label} data-value={value} className="min-w-32 max-w-full">
        {prefix}
        <SelectValue />
      </SelectTrigger>
      <SelectContent className={prefix ? '[&_[data-slot=select-item]]:pl-8.5' : undefined}>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value} data-value={item.value}>
            {item.icon}
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
