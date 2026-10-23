import type { Chart } from './api/types'

const titleLocales = ['en', 'ja', 'ko', 'zh'] as const

const headerText = (value: string | undefined) => (value ?? '').trim().replace(/[\r\n\0]/g, ' ')

/**
 * The TJA with its TITLE and SUBTITLE headers, and their translations
 * (TITLEJA and the like), replaced by the chart's own. The stored file
 * keeps what was uploaded; previews, the player and the editor show the names
 * the database has, as the server's package and the game's playable copy do.
 * Lines between #START and #END are left alone; the new headers take the place
 * of the first old one, and the text keeps its BOM and line endings. Mirrors
 * the official database's internal/tja.WithTitles.
 */
export function withChartTitles(
  source: string,
  chart: Pick<Chart, 'title' | 'subtitle' | 'titleTranslations' | 'subtitleTranslations'>,
): string {
  const bom = source.startsWith('\ufeff')
  const text = bom ? source.slice(1) : source
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const kept: string[] = []
  let at = -1
  let inChart = false
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const upper = line.trim().toUpperCase()
    if (upper.startsWith('#START')) inChart = true
    else if (upper.startsWith('#END')) inChart = false
    if (!inChart) {
      const colon = upper.indexOf(':')
      const key = colon < 0 ? '' : upper.slice(0, colon).trim()
      if (colon >= 0 && (key.startsWith('TITLE') || key.startsWith('SUBTITLE'))) {
        if (at < 0) at = kept.length
        continue
      }
    }
    kept.push(line)
  }
  const headers = [`TITLE:${headerText(chart.title)}`, `SUBTITLE:${headerText(chart.subtitle)}`]
  for (const [key, values] of [
    ['TITLE', chart.titleTranslations],
    ['SUBTITLE', chart.subtitleTranslations],
  ] as const) {
    for (const locale of titleLocales) {
      const value = headerText(values?.[locale])
      if (value) headers.push(`${key}${locale.toUpperCase()}:${value}`)
    }
  }
  if (at < 0) at = 0
  const result = [...kept.slice(0, at), ...headers, ...kept.slice(at)].join(newline)
  return bom ? `\ufeff${result}` : result
}
