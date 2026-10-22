import { describe, expect, it } from 'vitest'
import cases from '../contracts/validation.json'
import { maxMovie, parseTja, validateMovie, ValidationError } from './tja'

describe('shared TJA upload contract', () => {
  for (const c of cases)
    it(c.name, () => {
      const bytes = c.raw ? new Uint8Array(c.raw) : new TextEncoder().encode(c.text)
      if (c.code) {
        try {
          parseTja(bytes, c.encoding, c.audio)
          expect.fail('must reject invalid input')
        } catch (error) {
          expect(error).toBeInstanceOf(ValidationError)
          expect((error as ValidationError).code).toBe(c.code)
          if (c.line) expect((error as ValidationError).line).toBe(c.line)
        }
      } else {
        const metadata = parseTja(bytes, c.encoding, c.audio)
        expect(metadata.title).toBeTruthy()
        expect(metadata.difficulties.length).toBeGreaterThan(0)
        if (c.name === 'multi difficulty')
          expect(metadata.difficulties.map((d) => d.course)).toEqual(['Oni', 'Easy'])
      }
    })
})

it('defaults every difficulty to the scanned MAKER', () => {
  const text =
    'TITLE:Maker test\nMAKER:A\nBPM:120\nWAVE:test.ogg\n' +
    ['Hard', 'Oni', 'Edit']
      .map((course) => `COURSE:${course}\nLEVEL:5\n#START\n1000,\n#END\n`)
      .join('')
  const metadata = parseTja(new TextEncoder().encode(text), 'utf-8', 'test.ogg')
  expect(metadata.difficulties.map((d) => d.maker)).toEqual(['A', 'A', 'A'])
  const blank = parseTja(
    new TextEncoder().encode(text.replace('MAKER:A\n', '')),
    'utf-8',
    'test.ogg',
  )
  expect(blank.difficulties.map((d) => d.maker)).toEqual(['', '', ''])
})

it('reads single, P1 and P2 blocks of a course as slots of one file', () => {
  const header = 'TITLE:D\nBPM:120\nWAVE:a.ogg\nCOURSE:Oni\nLEVEL:8\n'
  const p1 = '#START P1\n1000,\n#END\n',
    p2 = '#START P2\n2000,\n#END\n',
    single = '#START\n1000,\n#END\n'
  const parse = (body: string) =>
    parseTja(new TextEncoder().encode(header + body), 'utf-8', 'a.ogg')
  const chart = parse('STYLE:Double\n' + p2 + p1)
  expect(chart.difficulties.map((d) => [d.course, d.side])).toEqual([
    ['Oni', 'p2'],
    ['Oni', 'p1'],
  ])
  expect(parse(single).difficulties.map((d) => d.side)).toEqual(['single'])
  expect(parse(p1 + single + p2).difficulties.map((d) => d.side)).toEqual(['p1', 'single', 'p2'])
  expect(() => parse(p1 + p1)).toThrow()
  expect(() => parse(single + p1 + single)).toThrow()
  expect(() => parse('STYLE:Double\n' + single)).toThrow()
})

it('reads BGMOVIE and MOVIEOFFSET and matches the selected video to them', () => {
  const text = (headers: string) =>
    `TITLE:M\nBPM:120\nWAVE:a.ogg\n${headers}COURSE:Oni\nLEVEL:5\n#START\n1000,\n#END\n`
  const parse = (headers: string) =>
    parseTja(new TextEncoder().encode(text(headers)), 'utf-8', 'a.ogg')
  const declared = parse('BGMOVIE:映像.mp4\nMOVIEOFFSET:-0.5\n')
  expect([declared.movie, declared.movieOffset]).toEqual(['映像.mp4', -0.5])
  const plain = parse('')
  expect([plain.movie, plain.movieOffset]).toEqual(['', 0])

  const file = (name: string, size = 10) => ({ name, size }) as File
  const code = (run: () => void) => {
    try {
      run()
      return ''
    } catch (e) {
      return (e as ValidationError).code
    }
  }
  expect(code(() => validateMovie(declared, file('映像.mp4')))).toBe('')
  expect(code(() => validateMovie(plain, null))).toBe('')
  expect(code(() => validateMovie(declared, null))).toBe('TJA_MOVIE_MISSING')
  // A replacement keeps the movie the chart already has.
  expect(code(() => validateMovie(declared, null, true))).toBe('')
  expect(code(() => validateMovie(declared, file('other.mp4')))).toBe('TJA_MOVIE_MISMATCH')
  expect(code(() => validateMovie(plain, file('映像.mp4')))).toBe('UPLOAD_FILES_INVALID')
  expect(code(() => validateMovie(parse('BGMOVIE:a.mov\n'), file('a.mov', 0)))).toBe(
    'UPLOAD_FILES_INVALID',
  )
  expect(code(() => validateMovie(declared, file('映像.mp4', maxMovie + 1)))).toBe(
    'FILE_SIZE_INVALID',
  )
})
