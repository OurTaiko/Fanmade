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
import { categoryStripeColor } from '@/category-colors'
import { CardCoverBackdrop, coveredTextClassName, useCardCover } from '@/components/card-cover'

export function ChartCard({ chart }: { chart: Chart }) {
  const { t } = useTranslation()

  const cover = useCardCover(coverSource(chart))
  const hasCover = !!cover.source
  if (!supportsChart(chart.difficulties)) return null
  return (
    <Link
      className="group block rounded-[14px] outline-none focus-visible:ring-ring focus-visible:ring-3 focus-visible:ring-offset-4 min-w-0 hover:-translate-y-0.5 motion-reduce:transform-none transition-transform motion-reduce:transition-none duration-150"
      data-testid="chart-card"
      to={`/charts/${chart.id}`}
    >
      {/* Fixed height: five difficulty bookmarks, the most a song has, fit exactly. */}
      <Card size="sm" className="isolate relative group-hover:shadow-drop-hover pt-6 pb-5 h-56 transition-shadow">
        <div
          aria-hidden="true"
          className="top-0 z-10 absolute inset-x-0 border-b-2 border-outline h-1.5"
          style={{ background: categoryStripeColor(chart.categoryIds) }}
        />
        {cover.source && <CardCoverBackdrop source={cover.source} onError={cover.onError} />}
        <CardContent className="relative flex gap-4 pr-4 pl-6 h-full min-h-0">
          <div className="flex flex-col flex-1 gap-4 min-w-0 min-h-0">
            <div className={cn('space-y-0.5 min-w-0', hasCover && coveredTextClassName)}>
              <h3
                className="font-extrabold text-lg truncate"
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
