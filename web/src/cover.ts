import { t } from './i18n'
import { endpoints } from '@/api/endpoints'
import type { Chart } from './api/types'

export const maxCoverBytes = 8 * 1024 * 1024
export function coverFileError(file: File): string {
  if (!/\.(jpe?g|png|webp)$/i.test(file.name)) return t('messages.coversMustBeJpgPngOrWebpFiles')
  if (!file.size || file.size > maxCoverBytes) return t('messages.coverMustNotBeEmptyOrExceed8Mib')
  return ''
}
export function coverSource(chart: Pick<Chart, 'id' | 'coverHash'>): string | undefined {
  return chart.coverHash ? endpoints.cover(chart.id, chart.coverHash) : undefined
}
