import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Chart } from './api/types'
import { buildChartPackage, entryName, packageFilename } from './chart-package'

const hash = (data: string) => createHash('sha256').update(data).digest('hex')
const audio = 'OggS audio bytes'
const tja = `TITLE:Song\nWAVE:${hash(audio)}.ogg\n`
const cover = 'RIFF cover'
const cdn = 'https://cdn.example/fanmade'
const chart = {
  id: 'song',
  tjaHash: hash(tja),
  audioHash: hash(audio),
  coverHash: hash(cover),
  wave: `${hash(audio)}.ogg`,
  createdAt: '2026-10-12T00:00:00Z',
} as Chart

/** Names and contents of the stored (uncompressed) entries, in archive order. */
async function entries(archive: Blob) {
  const bytes = new Uint8Array(await archive.arrayBuffer())
  const view = new DataView(bytes.buffer)
  const text = new TextDecoder()
  const found: Record<string, string> = {}
  for (let at = 0; view.getUint32(at, true) === 0x04034b50;) {
    const flags = view.getUint16(at + 6, true)
    const nameLength = view.getUint16(at + 26, true)
    const start = at + 30 + nameLength + view.getUint16(at + 28, true)
    const name = text.decode(bytes.subarray(at + 30, at + 30 + nameLength))
    // client-zip streams entries: sizes follow the data in a 16-byte descriptor.
    expect(flags & 8).toBe(8)
    let end = start
    while (view.getUint32(end, true) !== 0x08074b50) end++
    found[name] = text.decode(bytes.subarray(start, end))
    at = end + 16
  }
  return found
}

function serve(files: Record<string, string>, manifest?: unknown) {
  const requested: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      requested.push(`${init?.credentials ?? 'default'} ${input}`)
      if (input === '/api/v1/charts/song/resources')
        return manifest ? Response.json(manifest) : new Response('{}', { status: 404 })
      return input in files ? new Response(files[input]) : new Response('', { status: 403 })
    }),
  )
  return requested
}

const resource = (data: string, extension: string) => ({
  url: `${cdn}/${hash(data)}.${extension}`,
  sha256: hash(data),
  size: data.length,
})
const manifest = (resources: Record<string, unknown>) => ({ chartId: 'song', resources })
const stored = {
  [`${cdn}/${hash(tja)}.tja`]: tja,
  [`${cdn}/${hash(audio)}.ogg`]: audio,
  [`${cdn}/${hash(cover)}.webp`]: cover,
  [`${cdn}/preview.ogg`]: 'preview',
}

afterEach(() => vi.unstubAllGlobals())

describe('chart package', () => {
  it('names the archive after the displayed title', () => {
    expect(packageFilename('千本桜 / Senbonzakura: "A"?')).toBe('千本桜 Senbonzakura A.zip')
    expect(packageFilename(' ..さくら. ')).toBe('さくら.zip')
    expect(packageFilename('<>|')).toBe('chart.zip')
  })

  it('keeps stored names, ignoring signed URL queries', () => {
    expect(entryName(`${cdn}/${'a'.repeat(64)}.OGG?X-Amz-Signature=1.zip`, 'a'.repeat(64))).toBe(
      `${'a'.repeat(64)}.ogg`,
    )
    expect(() => entryName(`${cdn}/audio`, 'a'.repeat(64))).toThrow('PACKAGE_RESOURCE_INVALID')
  })

  it('packs the TJA, audio and cover from the resource manifest', async () => {
    const requested = serve(
      stored,
      manifest({
        cover: resource(cover, 'webp'),
        preview: { url: `${cdn}/preview.ogg`, sha256: hash('preview'), size: 7 },
        audio: resource(audio, 'ogg'),
        tja: resource(tja, 'tja'),
      }),
    )
    const archive = await buildChartPackage(chart, new AbortController().signal)
    expect(await entries(archive)).toEqual({
      [`${hash(tja)}.tja`]: tja,
      [`${hash(audio)}.ogg`]: audio,
      [`${hash(cover)}.webp`]: cover,
    })
    // The preview clip is not part of the package; file hosts get no cookies.
    expect(requested.slice(1).sort()).toEqual(
      [`${hash(tja)}.tja`, `${hash(audio)}.ogg`, `${hash(cover)}.webp`]
        .map((name) => `omit ${cdn}/${name}`)
        .sort(),
    )
  })

  it('packs the background movie between the audio and the cover', async () => {
    const movie = 'ftyp movie'
    serve(
      { ...stored, [`${cdn}/${hash(movie)}.mp4`]: movie },
      manifest({
        movie: resource(movie, 'mp4'),
        cover: resource(cover, 'webp'),
        audio: resource(audio, 'ogg'),
        tja: resource(tja, 'tja'),
      }),
    )
    const archive = await buildChartPackage(chart, new AbortController().signal)
    expect(Object.keys(await entries(archive))).toEqual([
      `${hash(tja)}.tja`,
      `${hash(audio)}.ogg`,
      `${hash(movie)}.mp4`,
      `${hash(cover)}.webp`,
    ])
  })

  it('omits the cover when the chart has none', async () => {
    serve(stored, manifest({ audio: resource(audio, 'ogg'), tja: resource(tja, 'tja') }))
    const archive = await buildChartPackage(chart, new AbortController().signal)
    expect(Object.keys(await entries(archive))).toEqual([`${hash(tja)}.tja`, `${hash(audio)}.ogg`])
  })

  it('reads the stored files through the API when there are no direct links', async () => {
    serve({
      '/api/v1/charts/song/tja': tja,
      '/api/v1/charts/song/audio': audio,
      '/api/v1/charts/song/movie': 'ftyp movie',
      [`/api/v1/charts/song/cover?v=${hash(cover)}`]: cover,
    })
    const withMovie = { ...chart, movieHash: hash('ftyp movie') }
    const archive = await buildChartPackage(withMovie, new AbortController().signal)
    expect(await entries(archive)).toEqual({
      [`${hash(tja)}.tja`]: tja,
      [`${hash(audio)}.ogg`]: audio,
      [`${hash('ftyp movie')}.mp4`]: 'ftyp movie',
      [`${hash(cover)}.webp`]: cover,
    })
  })

  it('rejects changed, corrupt or missing files', async () => {
    const signal = new AbortController().signal
    serve(stored, manifest({ audio: resource(audio, 'ogg'), tja: resource('newer', 'tja') }))
    await expect(buildChartPackage(chart, signal)).rejects.toThrow('PACKAGE_CHART_CHANGED')
    serve(
      { ...stored, [`${cdn}/${hash(audio)}.ogg`]: 'OggS AUDIO bytes' },
      manifest({ audio: resource(audio, 'ogg'), tja: resource(tja, 'tja') }),
    )
    await expect(buildChartPackage(chart, signal)).rejects.toThrow('PACKAGE_INTEGRITY_FAILED')
    serve({}, manifest({ audio: resource(audio, 'ogg'), tja: resource(tja, 'tja') }))
    await expect(buildChartPackage(chart, signal)).rejects.toThrow('PACKAGE_DOWNLOAD_FAILED')
  })
})
