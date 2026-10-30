import { describe, expect, it } from 'vitest'
import fixtures from '@sitekit/testdata/encoding.json'
import { maxTja, validateFiles } from './tja'

const text = 'TITLE:初音ミク\nBPM:120\nWAVE:music.ogg\nCOURSE:Oni\nLEVEL:5\n#START\n1000,\n#END\n'
const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16))

// The conversion itself is tested with OurTaikoSiteKit's tja-encoding; these check the upload's use of it.
describe('uploading a TJA in another encoding', () => {
  it.each(fixtures)(
    'uploads $encoding as UTF-8 without changing metadata or notes',
    async (fixture) => {
      const original = fromHex(fixture.hex)
      const tja = new File([original], 'chart.tja')
      const result = await validateFiles(tja, new File(['OggS fixture'], fixture.wave))
      expect(await result.file.text()).toBe(fixture.text)
      expect(result.title).toBe(fixture.title)
      expect(result.file.name).toBe('chart.tja')
      expect(new Uint8Array(await tja.arrayBuffer())).toEqual(original)
      expect(result.file.type).toBe('text/plain;charset=utf-8')
    },
  )
  it('checks WAVE after conversion', async () => {
    const fixture = fixtures[0]
    await expect(
      validateFiles(new File([fromHex(fixture.hex)], 'chart.tja'), new File(['OggS'], 'wrong.ogg')),
    ).rejects.toMatchObject({ code: 'TJA_AUDIO_MISMATCH' })
  })
  it('enforces the size limit again after UTF-8 expansion', async () => {
    const expanded = text + ('// ' + 'あ'.repeat(200) + '\n').repeat(4000)
    const value = '﻿' + expanded
    const source = new Uint8Array(value.length * 2)
    const view = new DataView(source.buffer)
    for (let i = 0; i < value.length; i++) view.setUint16(i * 2, value.charCodeAt(i), true)
    expect(source.length).toBeLessThan(maxTja)
    await expect(
      validateFiles(new File([source], 'chart.tja'), new File(['OggS'], 'music.ogg')),
    ).rejects.toMatchObject({ code: 'FILE_SIZE_INVALID' })
  })
})
