import { chartText } from '@/chart-language'
import { i18n } from '@/i18n'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { Chart } from '@/api/types'
import { coverSource } from '@/cover'
import { CategoryLabels } from '@/categories'
import { supportsChart } from '@/courses'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { DifficultyBadges } from '@/components/difficulty-badges'
import { compactNumber } from '@/components/vote-control'
import { ArrowFatUpIcon, ChatCircleIcon } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { CardCoverBackdrop, coveredTextClassName, useCardCover } from '@/components/card-cover'

export function ChartCard({ chart }: { chart: Chart }) {
  const { t } = useTranslation()

  const cover = useCardCover(coverSource(chart))
  const hasCover = !!cover.source
  if (!supportsChart(chart.difficulties)) return null
  return (
    <Link
      className="group block rounded-2xl outline-none focus-visible:ring-[#0071e3] focus-visible:ring-2 focus-visible:ring-offset-4 min-w-0 motion-reduce:transform-none active:scale-[0.98] transition-transform motion-reduce:transition-none duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1)] chart-information"
      data-testid="chart-card"
      to={`/charts/${chart.id}`}
    >
      {/* Fixed height: five difficulty bookmarks, the most a song has, fit exactly. */}
      <Card
        size="sm"
        className="isolate relative bg-white dark:bg-card shadow-[0_4px_12px_rgba(0,0,0,0.08)] py-5 rounded-2xl ring-0 h-56"
      >
        {cover.source && <CardCoverBackdrop source={cover.source} onError={cover.onError} />}
        <CardContent className="relative flex gap-4 pr-0 pl-6 h-full min-h-0">
          <div className="flex flex-col flex-1 gap-4 min-w-0 min-h-0">
            <div className={cn('space-y-0.5 min-w-0', hasCover && coveredTextClassName)}>
              <h3
                className="font-semibold text-lg truncate tracking-tight"
                title={chartText(chart, i18n.resolvedLanguage).title}
              >
                {chartText(chart, i18n.resolvedLanguage).title}
              </h3>
              <p
                className={cn(
                  'text-sm truncate',
                  hasCover ? 'text-foreground/80' : 'text-muted-foreground',
                )}
                title={chartText(chart, i18n.resolvedLanguage).subtitle}
              >
                {chartText(chart, i18n.resolvedLanguage).subtitle}
              </p>
            </div>
            {/* Two rows of facts at most; a third row is cut off whole. */}
            <div className="max-h-[3.25rem] overflow-hidden">
              <CategoryLabels ids={chart.categoryIds}>
                <li className="min-w-0 max-w-full">
                  <Badge
                    variant="outline"
                    className="gap-0 p-0 min-w-0 max-w-full"
                    title={t('messages.chartCreatorWithName', {
                      name: chart.maker || chart.uploader,
                    })}
                  >
                    <span className="flex items-center bg-muted px-2 border-r h-full text-muted-foreground shrink-0">
                      {t('messages.chartCreator')}
                    </span>
                    <span className="px-2 truncate">{chart.maker || chart.uploader}</span>
                  </Badge>
                </li>
                <li>
                  <Badge variant="outline" className="tabular-nums">
                    {chart.bpm} BPM
                  </Badge>
                </li>
              </CategoryLabels>
            </div>
            <ul
              className="flex items-center gap-2 mt-auto"
              aria-label={t('messages.chartInformation')}
            >
              <li>
                <Badge
                  variant="outline"
                  className="tabular-nums"
                  title={t('interactions.scoreExact', { score: chart.score })}
                >
                  <ArrowFatUpIcon className="size-3" aria-hidden="true" />
                  <span className="sr-only">{t('interactions.score')}</span>
                  {compactNumber(chart.score, i18n.resolvedLanguage ?? '')}
                </Badge>
              </li>
              <li>
                <Badge
                  variant="outline"
                  className="tabular-nums"
                  title={t('interactions.commentCount', { count: chart.commentCount })}
                >
                  <ChatCircleIcon className="size-3" aria-hidden="true" />
                  <span className="sr-only">
                    {t('interactions.commentCount', { count: chart.commentCount })}
                  </span>
                  <span aria-hidden="true">
                    {compactNumber(chart.commentCount, i18n.resolvedLanguage ?? '')}
                  </span>
                </Badge>
              </li>
            </ul>
          </div>
          <DifficultyBadges difficulties={chart.difficulties} bookmarks />
        </CardContent>
      </Card>
    </Link>
  )
}
