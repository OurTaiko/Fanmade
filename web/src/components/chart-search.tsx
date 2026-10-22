import { useTranslation } from 'react-i18next'
import { SortDescendingIcon } from '@phosphor-icons/react'
import { ChoiceSelect } from '@/components/choice-select'
import { SearchInput } from '@/components/search-input'

// The website's song orders. Difficulty, star and completion filters belong to
// the game's search only.
export const chartOrders = ['hot', 'top', 'comments'] as const
export type ChartOrder = (typeof chartOrders)[number]

export function useChartOrderLabels(): Record<'' | ChartOrder, string> {
  const { t } = useTranslation()
  return {
    '': t('messages.latestCharts'),
    hot: t('interactions.orderHot'),
    top: t('interactions.orderTop'),
    comments: t('interactions.orderComments'),
  }
}

export function ChartSearch({
  query,
  order,
  onSearch,
  onPendingChange,
  onChange,
}: {
  query: string
  order: '' | ChartOrder
  onSearch: (query: string) => void
  onPendingChange: (pending: boolean) => void
  onChange: (values: Record<string, string>) => void
}) {
  const { t } = useTranslation()
  const labels = useChartOrderLabels()
  return (
    <div
      role="search"
      aria-label={t('messages.searchAndFilterCharts')}
      className="flex flex-col gap-3 sm:flex-row sm:items-center"
    >
      <SearchInput value={query} onSearch={onSearch} onPendingChange={onPendingChange} />
      <div className="shrink-0 [&_[data-slot=select-trigger]]:w-full sm:[&_[data-slot=select-trigger]]:w-auto">
        <ChoiceSelect
          label={t('messages.searchOrder')}
          value={order}
          prefix={
            <SortDescendingIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          }
          items={(['', ...chartOrders] as const).map((value) => ({ value, label: labels[value] }))}
          onValueChange={(value) => onChange({ order: value })}
        />
      </div>
    </div>
  )
}
