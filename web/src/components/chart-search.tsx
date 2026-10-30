import { useTranslation } from 'react-i18next'
import type { ComponentProps } from 'react'
import { ChartSearch as SharedChartSearch } from '@sitekit/components/chart-search'

// The website's song orders; completion filters belong to the game's search only.
export const chartOrders = ['hot', 'top', 'comments', 'updated'] as const
export type ChartOrder = (typeof chartOrders)[number]

export function useChartOrderLabels(): Record<'' | ChartOrder, string> {
  const { t } = useTranslation()
  return {
    '': t('messages.latestCharts'),
    hot: t('interactions.orderHot'),
    top: t('interactions.orderTop'),
    comments: t('interactions.orderComments'),
    updated: t('interactions.orderUpdated'),
  }
}

/** OurTaikoSiteKit's chart search with this site's orders. */
export function ChartSearch(
  props: Omit<ComponentProps<typeof SharedChartSearch>, 'orders' | 'orderLabels'>,
) {
  const labels = useChartOrderLabels()
  return <SharedChartSearch {...props} orders={chartOrders} orderLabels={labels} />
}
