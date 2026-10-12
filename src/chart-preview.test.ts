import { beforeEach, describe, expect, it } from 'vitest'
import { i18n } from './i18n'
import { courseNames, supportsChart } from './courses'
import { defaultDifficulty } from './chart-difficulty'
import { parsePreviewTja } from './preview-tja'
import type { Difficulty } from './tja'

beforeEach(async () => {
  await i18n.changeLanguage('zh-Hans')
})

describe('detail difficulty selection', () => {
  const courses = ['Easy', 'Normal', 'Hard', 'Edit', 'Oni']
  it('defaults to Oni and follows the requested fallback order', () => {
    while (courses.length) {
      const difficulties: Difficulty[] = courses.map((course) => ({
        course,
        maker: '',
        level: 5,
      }))
      expect(defaultDifficulty(difficulties)).toBe(courses.at(-1))
      courses.pop()
    }
    expect(defaultDifficulty([])).toBe('')
    expect(defaultDifficulty([{ course: 'Tower', level: 5, maker: '' }])).toBe('')
    expect(Object.keys(courseNames)).toHaveLength(15)
    expect(supportsChart([{ course: 'Oni_1p' }, { course: 'Oni_2p' }])).toBe(true)
    expect(
      defaultDifficulty([
        { course: 'Oni_2p', level: 10, maker: '' },
        { course: 'Oni_1p', level: 9, maker: '' },
      ]),
    ).toBe('Oni_1p')
    expect(supportsChart([{ course: 'Oni' }, { course: 'Dan' }])).toBe(false)
    expect(supportsChart([{ course: 'Oni' }, { course: 'Edit' }])).toBe(true)
  })
})

describe('TJA renderer input adapter', () => {
  it('isolates Single and P1/P2 blocks of a numeric course without losing metadata', () => {
    const text = `TITLE:English name
BPM:150
COURSE:3
LEVEL:8
STYLE:Single
#START
1111,
#END
COURSE:3
LEVEL:10
STYLE:Double
#START P1
2222,
#END
#START P2
3333,
#END
COURSE:Hard
LEVEL:6
#START
1212,
#END`
    const parsed = parsePreviewTja(text)
    expect(Object.keys(parsed)).toEqual(['Oni', 'Oni_1p', 'Oni_2p', 'Hard'])
    expect(Object.values(parsed).map((c) => c.level)).toEqual([8, 10, 10, 6])
    expect(Object.values(parsed).map((c) => c.bars[0].join(''))).toEqual([
      '1111',
      '2222',
      '3333',
      '1212',
    ])
    expect(Object.values(parsed).every((c) => c.title === 'English name' && c.bpm === 150)).toBe(
      true,
    )
  })
  it('accepts BOM, CRLF, comments, lowercase headers and the implicit Oni course', () => {
    const parsed = parsePreviewTja(
      '\uFEFFtitle:Song\r\nbpm:180\r\nlevel:7\r\n#start // comment\r\n1000,\r\n#end\r\n',
    )
    expect(parsed.Oni.title).toBe('Song')
    expect(parsed.Oni.level).toBe(7)
    expect(parsed.Oni.bars[0].join('')).toBe('1000')
  })
  it('preserves selectable branch charts', () => {
    const parsed = parsePreviewTja(`TITLE:Branch
BPM:120
COURSE:Oni
#START
1000,
#BRANCHSTART p,50,80
#N
1111,
#E
2222,
#M
1212,
#BRANCHEND
#END`)
    expect(Object.keys(parsed.Oni.branches ?? {})).toEqual(['normal', 'expert', 'master'])
    expect(parsed.Oni.branches?.master?.bars.some((bar) => bar.join('') === '1212')).toBe(true)
  })
  it.each(['Tower', 'Dan', '5', '6', 'tower', 'dAn'])('rejects %s in preview input', (course) => {
    expect(() =>
      parsePreviewTja(
        `TITLE:Song\nBPM:120\nCOURSE:Oni\n#START\n1,\n#END\nCOURSE:${course}\n#START\n1,\n#END`,
      ),
    ).toThrow('仅支持')
  })
  it('reports incomplete data instead of showing another chart', () => {
    expect(() => parsePreviewTja('TITLE:Empty')).toThrow()
    expect(() => parsePreviewTja('COURSE:Oni\n#START\n1,')).toThrow()
  })
})

it('keeps side identities when the TJA starts with P2', () => {
  const parsed = parsePreviewTja(
    'TITLE:D\nBPM:120\nCOURSE:Oni\nLEVEL:10\n#START P2\n2222,\n#END\n#START P1\n1111,\n#END',
  )
  expect(parsed.Oni_1p.bars[0].join('')).toBe('1111')
  expect(parsed.Oni_2p.bars[0].join('')).toBe('2222')
})
