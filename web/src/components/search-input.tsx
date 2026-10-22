import { useTranslation } from 'react-i18next'
import { useEffect, useRef, useState } from 'react'
import { MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function SearchInput({
  value,
  onSearch,
  onPendingChange,
  label,
  placeholder,
}: {
  label?: string
  placeholder?: string
  value: string
  onSearch: (query: string) => void
  onPendingChange: (pending: boolean) => void
}) {
  const { t } = useTranslation()

  const [query, setQuery] = useState(value)
  const [composing, setComposing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    onPendingChange(composing || query !== value)
  }, [query, value, composing, onPendingChange])

  useEffect(() => () => onPendingChange(false), [onPendingChange])

  useEffect(() => {
    setQuery(value)
  }, [value])

  useEffect(() => {
    if (composing || query === value) return
    const timer = window.setTimeout(() => onSearch(query), 400)
    return () => window.clearTimeout(timer)
  }, [query, value, composing, onSearch])

  return (
    <div className="relative min-w-0 flex-1">
      <MagnifyingGlassIcon
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={inputRef}
        className="pr-10 pl-9 [&::-webkit-search-cancel-button]:appearance-none"
        type="search"
        aria-label={label ?? t('messages.searchCharts')}
        placeholder={placeholder ?? t('messages.searchChartKeywords')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={(event) => {
          setQuery(event.currentTarget.value)
          setComposing(false)
        }}
      />
      {query && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground"
          aria-label={t('messages.clearSearch')}
          onClick={() => {
            setQuery('')
            setComposing(false)
            inputRef.current?.focus()
          }}
        >
          <XIcon className="size-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}
