import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateFiles } from './tja'

const chart = (wave: string) =>
  new File(
    [`TITLE:MP3 Test\nBPM:120\nWAVE:${wave}\nCOURSE:Oni\nLEVEL:5\n#START\n1000,\n#END\n`],
    'chart.tja',
  )
const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./testdata/${name}`, import.meta.url)))

describe('audio upload validation', () => {
  it.each(['cbr.mp3', 'raw.mp3'])('accepts %s with and without ID3 tags', async (name) => {
    const audio = new File([fixture(name)], name, { type: 'application/octet-stream' })
    await expect(validateFiles(chart(name), audio)).resolves.toMatchObject({ wave: name })
  })
  it('accepts uppercase extensions without trusting browser MIME', async () => {
    const audio = new File([fixture('cbr.mp3')], 'music.MP3', { type: 'audio/ogg' })
    await expect(validateFiles(chart('music.MP3'), audio)).resolves.toMatchObject({
      wave: 'music.MP3',
    })
  })
  it('blocks a filename mismatch before submission', async () => {
    const audio = new File([fixture('cbr.mp3')], 'other.mp3')
    await expect(validateFiles(chart('music.mp3'), audio)).rejects.toMatchObject({
      code: 'TJA_AUDIO_MISMATCH',
    })
  })
  it.each([
    ['fake.mp3', new TextEncoder().encode('OggS not MP3')],
    ['fake.ogg', fixture('cbr.mp3')],
    ['fake.mp3', new TextEncoder().encode('ID3fake')],
    ['fake.mp3', new Uint8Array([73, 68, 51, 4, 0, 0, 127, 127, 127, 127])],
    ['fake.mp3', new Uint8Array([255, 249, 80, 128])],
  ])('rejects false or truncated headers for %s', async (name, data) => {
    await expect(validateFiles(chart(name), new File([data], name))).rejects.toMatchObject({
      code: 'AUDIO_INVALID',
    })
  })
  it('preserves OGG header validation', async () => {
    await expect(
      validateFiles(chart('music.ogg'), new File(['OggS fixture'], 'music.ogg')),
    ).resolves.toMatchObject({ wave: 'music.ogg' })
  })
})
