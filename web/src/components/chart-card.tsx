import type { Chart } from '@/api/types'
import {
  BpmBadge,
  BranchingBadge,
  ChartCard as SharedChartCard,
  CommentCountBadge,
  DoubleBadge,
  DurationBadge,
  MakerBadge,
  ScoreBadge,
} from '@sitekit/components/chart-card'

export function ChartCard({ chart }: { chart: Chart }) {
  return (
    <SharedChartCard
      chart={chart}
      facts={
        <>
          <MakerBadge name={chart.maker || chart.uploader} />
          <BpmBadge bpm={chart.bpm} />
          <DurationBadge seconds={chart.duration} />
        </>
      }
      footer={
        <>
          <DoubleBadge difficulties={chart.difficulties} />
          <BranchingBadge difficulties={chart.difficulties} />
          <ScoreBadge score={chart.score} />
          <CommentCountBadge count={chart.commentCount} />
        </>
      }
    />
  )
}
