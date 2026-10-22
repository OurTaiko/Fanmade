import { t } from './i18n'
import { parseTjaCourse } from './courses'
import { parseTJA } from '../TJARenderer/src/tja-parser'
import type { ParsedChart } from '../TJARenderer/src/tja-parser'

// Isolate each #START block before rendering. This preserves Single / Double
// blocks sharing a course and accepts numeric COURSE headers just like the API.
export function parsePreviewTja(text: string): Record<string, ParsedChart> {
  const globalHeaders: Record<string, string> = {}
  let courseHeaders: Record<string, string> = {}
  let hasCourse = false
  let inBlock = false
  let block = 0
  let course = 'Oni'
  const keys: string[] = []
  const source: string[] = []
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
    const line = raw.split('//', 1)[0].trim()
    if (!line) continue
    if (/^#START(?:\s|$)/i.test(line)) {
      if (inBlock) throw new Error(t('messages.tjaChartBlockIsNotProperlyClosed'))
      const player = /^#START\s+P([12])$/i.exec(line)?.[1]
      const key = course + (player ? `_${player}p` : '')
      if (keys.includes(key)) throw new Error(t('messages.duplicateCourse'))
      keys.push(key)
      const headers = { ...globalHeaders, ...courseHeaders }
      source.push(
        `COURSE:preview_${block}`,
        ...Object.entries(headers).map(([key, value]) => `${key}:${value}`),
        '#START',
      )
      inBlock = true
    } else if (/^#END\s*$/i.test(line)) {
      if (!inBlock) throw new Error(t('messages.tjaChartBlockIsMissingAStartMarker'))
      source.push('#END')
      inBlock = false
      block++
    } else if (inBlock) {
      source.push(line.startsWith('#') ? line.replace(/^#[a-z]+/i, (s) => s.toUpperCase()) : line)
    } else {
      const separator = line.indexOf(':')
      if (separator < 0) continue
      const key = line.slice(0, separator).trim().toUpperCase()
      const value = line.slice(separator + 1).trim()
      if (key === 'COURSE') {
        if (!parseTjaCourse(value))
          throw new Error(t('messages.previewSupportsOnlyEasyNormalHardOniEdit'))
        course = parseTjaCourse(value)!
        hasCourse = true
        courseHeaders = {}
      } else {
        ;(hasCourse ? courseHeaders : globalHeaders)[key] = value
      }
    }
  }
  if (inBlock || block === 0) throw new Error(t('messages.tjaHasNoCompleteChartBlocks'))
  const parsed = parseTJA(source.join('\n'))
  return Object.fromEntries(
    Array.from({ length: block }, (_, index) => {
      const chart = parsed[`preview_${index}`]
      if (!chart?.bars.length)
        throw new Error(t('messages.chartBlockPreviewError', { block: index + 1 }))
      return [keys[index], chart]
    }),
  )
}
