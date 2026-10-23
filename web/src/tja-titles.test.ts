import { describe, expect, it } from 'vitest'
import { withChartTitles } from './tja-titles'

describe('withChartTitles', () => {
  it('replaces the title headers as the server does', () => {
    const source =
      '\ufeffTITLE:Old\r\nTITLEJA:古い\r\nSUBTITLE:--Old artist\r\nBPM:120\r\nWAVE:a.ogg\r\nCOURSE:Oni\r\nLEVEL:8\r\n#START\r\nTITLE:not a header\r\n1,\r\n#END\r\n'
    expect(
      withChartTitles(source, {
        title: 'New',
        subtitle: '--New artist',
        titleTranslations: { en: 'New', zh: '新曲', ja: '' },
        subtitleTranslations: { en: 'New artist' },
      }),
    ).toBe(
      '\ufeffTITLE:New\r\nSUBTITLE:--New artist\r\nTITLEEN:New\r\nTITLEZH:新曲\r\nSUBTITLEEN:New artist\r\nBPM:120\r\nWAVE:a.ogg\r\nCOURSE:Oni\r\nLEVEL:8\r\n#START\r\nTITLE:not a header\r\n1,\r\n#END\r\n',
    )
  })
  it('puts the headers first when there were none', () => {
    expect(
      withChartTitles('BPM:100\n', {
        title: 'A\nB',
        subtitle: '',
        titleTranslations: {},
        subtitleTranslations: {},
      }),
    ).toBe('TITLE:A B\nSUBTITLE:\nBPM:100\n')
  })
})
