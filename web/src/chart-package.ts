import { downloadZip } from 'client-zip'
import { endpoints } from './api/endpoints'
import type { Chart } from './api/types'
import { withChartTitles } from './tja-titles'

type PackageFile = { url: string; name: string; sha256?: string; size?: number; tja?: boolean }
type Manifest = {
  resources: Partial<Record<string, { url: string; sha256: string; size: number }>>
}

/** Stored files that make up a chart package, in archive order. */
const packaged = ['tja', 'audio', 'movie', 'cover'] as const

/** Characters that Windows, macOS or Linux reject in a file name. */
const unsafe = /[\\/:*?"<>|\p{Cc}]/gu

/** Name the archive after the title shown on the page. */
export function packageFilename(title: string) {
  const name = title
    .replace(unsafe, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[ .]+|[ .]+$/g, '')
  return `${name || 'chart'}.zip`
}

/** Files keep their stored names, so the TJA's WAVE finds the audio beside it. */
export function entryName(url: string, sha256: string) {
  const extension = /\.([a-z0-9]+)$/i.exec(new URL(url, 'http://localhost').pathname)?.[1]
  if (!extension) throw new Error('PACKAGE_RESOURCE_INVALID')
  return `${sha256}.${extension.toLowerCase()}`
}

/** Without direct resource links the API serves the same stored files itself. */
function apiFiles(chart: Chart): PackageFile[] {
  // The API does not publish the stored TJA's hash any more (a chart's identity is each
  // block's chartHash); the fallback trusts the API's own file route for it.
  const files: PackageFile[] = [
    { url: endpoints.resource(chart, 'tja'), name: chart.tjaName, tja: true },
    { url: endpoints.resource(chart, 'audio'), name: chart.wave, sha256: chart.audioHash },
  ]
  if (chart.movieHash)
    files.push({
      url: endpoints.resource(chart, 'movie'),
      name: `${chart.movieHash}.mp4`,
      sha256: chart.movieHash,
    })
  if (chart.coverHash)
    files.push({
      url: endpoints.cover(chart.id, chart.coverHash),
      name: `${chart.coverHash}.webp`,
      sha256: chart.coverHash,
    })
  return files
}

async function packageFiles(chart: Chart, signal: AbortSignal): Promise<PackageFile[]> {
  const response = await fetch(endpoints.resources(chart.id), { signal })
  if (response.status === 404) return apiFiles(chart)
  if (!response.ok) throw new Error('PACKAGE_RESOURCES_UNAVAILABLE')
  const { resources } = (await response.json()) as Manifest
  // The page may be older than the files it would name the archive after.
  if (!resources.tja || resources.audio?.sha256 !== chart.audioHash)
    throw new Error('PACKAGE_CHART_CHANGED')
  return packaged.flatMap((kind) => {
    const file = resources[kind]
    return file ? [{ ...file, name: entryName(file.url, file.sha256), tja: kind === 'tja' }] : []
  })
}

async function sha256(data: ArrayBuffer) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Download the chart's stored files and pack them in the browser. Every file
 * is checked against the hash the API published before it enters the archive.
 */
export async function buildChartPackage(chart: Chart, signal: AbortSignal): Promise<Blob> {
  const files = await packageFiles(chart, signal)
  const entries = await Promise.all(
    files.map(async ({ url, name, sha256: expected, size, tja }) => {
      const response = await fetch(url, { signal, credentials: 'omit' })
      if (!response.ok) throw new Error('PACKAGE_DOWNLOAD_FAILED')
      const input = await response.arrayBuffer()
      if (
        (size !== undefined && input.byteLength !== size) ||
        (expected !== undefined && (await sha256(input)) !== expected)
      )
        throw new Error('PACKAGE_INTEGRITY_FAILED')
      // After the check, the TJA's headers get the chart's own names; the
      // stored file keeps what was uploaded.
      if (tja) {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(input)
        return {
          name,
          input: new TextEncoder().encode(withChartTitles(text, chart)),
          lastModified: new Date(chart.createdAt),
        }
      }
      return { name, input, lastModified: new Date(chart.createdAt) }
    }),
  )
  return downloadZip(entries).blob()
}

/** Hand a finished archive to the browser's download manager. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
