// What this site gives OurTaikoSiteKit's shared pages (see the kit's site.tsx).
import type { Site } from '@sitekit/site'
import type { ChartFilters } from '@sitekit/components/chart-search'
import type { Chart } from '@/api/types'
import { ChartCard } from '@/components/chart-card'
import { ChartSearch, chartOrders, useChartOrderLabels } from '@/components/chart-search'
import { EditMetadata } from './edit-metadata'
import { UploadPage } from './upload'

export const site: Site = {
  brand: 'Fanmade',
  canUpload: () => true,
  chartCard: (chart) => <ChartCard chart={chart as Chart} />,
  chartOrders,
  useChartOrderLabels,
  chartSearch: ({ filters, ...props }) => (
    <ChartSearch {...props} filters={filters as ChartFilters} />
  ),
  EditMetadata: ({ chart, onSaved, ...props }) => (
    <EditMetadata {...props} chart={chart as Chart} onSaved={onSaved} />
  ),
  UploadPage,
}
