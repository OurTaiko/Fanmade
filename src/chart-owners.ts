import type { Chart } from './api/types'

export function chartOwners(chart: Chart) {
  return (
    chart.owners ?? [
      { id: chart.ownerId, nickname: chart.uploader, avatarUrl: chart.uploaderAvatarUrl },
    ]
  )
}

export function isChartOwner(chart: Chart, userId?: string) {
  return !!userId && (chart.ownerIds ?? [chart.ownerId]).includes(userId)
}
