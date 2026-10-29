import { describe, expect, it } from 'vitest'
import { replacementFields, reviewReplacement } from './replacement-diff'
import type { CurrentChart, Proposal, ReplacementPreview } from './replacement-diff'

const file = (overrides: Partial<ReplacementPreview['metadata']> = {}) => ({
  title: 'Song',
  subtitle: '',
  titleTranslations: { origin: 'Song' },
  subtitleTranslations: {},
  maker: 'A',
  bpm: 120,
  offset: 0,
  demoStart: 10,
  wave: 'song.ogg',
  movieOffset: 0,
  difficulties: [
    { course: 'Hard', side: 'single' as const, level: 5, maker: 'A' },
    { course: 'Oni', side: 'single' as const, level: 8, maker: 'A' },
  ],
  ...overrides,
})
// The site renamed the chart, moved its preview and credited Oni to B.
const chart = {
  ...file(),
  title: 'Site title',
  titleTranslations: { origin: 'Site title', ja: '曲' },
  demoStart: 20,
  demoEnd: 30,
  audioHash: 'a'.repeat(64),
  audioSize: 1,
  description: 'About',
  categoryIds: ['variety'],
  difficulties: [
    { course: 'Hard', side: 'single' as const, level: 5, maker: 'A' },
    { course: 'Oni', side: 'single' as const, level: 8, maker: 'B' },
  ],
} satisfies CurrentChart
const proposal: Proposal = {
  description: 'About',
  categoryIds: ['variety'],
  demoStart: 10,
  demoEnd: 25,
  typedMakers: {},
  typedDemo: false,
}
const editable = { demo: true, makers: true }
const blocks: ReplacementPreview['blocks'] = [
  { course: 'Hard', side: 'single', change: 'same', scores: 2 },
  { course: 'Oni', side: 'single', change: 'changed', scores: 3 },
  { course: 'Edit', side: 'single', change: 'removed', scores: 1 },
]

describe('reviewReplacement', () => {
  it('keeps site edits the new file did not touch', () => {
    const review = reviewReplacement(
      chart,
      { metadata: file(), previous: file(), blocks },
      proposal,
      false,
      editable,
    )
    expect(review.keepable.map((c) => [c.key, c.keep])).toEqual([
      ['titles', true],
      ['demo', true],
      ['maker:Oni', true],
    ])
    expect(review.keepable[0].lines).toEqual([
      { label: { field: 'title' }, from: 'Site title', to: 'Song' },
      { label: { field: 'title', locale: 'ja' }, from: '曲', to: '' },
    ])
    expect(review.keepable[1].lines[0]).toMatchObject({ from: '20–30', to: '10–25' })
  })

  it('applies what the new file changed or the page typed', () => {
    const next = file({
      title: 'Renamed',
      demoStart: 12,
      difficulties: [
        { course: 'Hard', side: 'single', level: 6, maker: 'A' },
        { course: 'Oni', side: 'single', level: 8, maker: 'C' },
      ],
    })
    const review = reviewReplacement(
      chart,
      { metadata: next, previous: file(), blocks },
      { ...proposal, description: 'New', typedMakers: { Hard: 'D' } },
      false,
      editable,
    )
    expect(review.keepable.map((c) => [c.key, c.keep])).toEqual([
      ['titles', false],
      ['demo', false],
      ['description', false],
      ['maker:Hard', false],
      ['maker:Oni', false],
    ])
  })

  it('applies everything when the stored file cannot be read', () => {
    const review = reviewReplacement(
      chart,
      { metadata: file(), previous: null, blocks },
      proposal,
      false,
      editable,
    )
    expect(review.keepable.every((c) => !c.keep)).toBe(true)
  })

  it('tells what happens to each block, all retired by new audio', () => {
    const preview = { metadata: file(), previous: file(), blocks }
    expect(reviewReplacement(chart, preview, proposal, false, editable).blocks).toEqual([
      {
        slot: 'Hard',
        course: 'Hard',
        side: 'single',
        change: 'same',
        from: 5,
        to: 5,
        scores: 2,
        effect: 'none',
      },
      {
        slot: 'Oni',
        course: 'Oni',
        side: 'single',
        change: 'changed',
        from: 8,
        to: 8,
        scores: 3,
        effect: 'retire',
      },
      {
        slot: 'Edit',
        course: 'Edit',
        side: 'single',
        change: 'removed',
        from: undefined,
        to: undefined,
        scores: 1,
        effect: 'delete',
      },
    ])
    expect(reviewReplacement(chart, preview, proposal, true, editable).blocks[0].effect).toBe(
      'retire',
    )
  })

  it('lists values only the file sets', () => {
    const review = reviewReplacement(
      chart,
      { metadata: file({ bpm: 150 }), previous: file(), blocks },
      proposal,
      false,
      editable,
    )
    expect(review.facts).toEqual([{ label: { field: 'bpm' }, from: '120', to: '150' }])
  })
})

describe('reviewReplacement on Database', () => {
  const database = { demo: false, makers: false }
  it('lists the preview range and makers with what only the file sets', () => {
    const review = reviewReplacement(
      { ...chart, nijiiroId: 7, officialId: null },
      { metadata: file(), previous: file(), blocks },
      { ...proposal, typedDemo: true, typedMakers: { Oni: 'Z' }, nijiiroId: '8', officialId: '' },
      false,
      database,
    )
    expect(review.keepable.map((c) => c.key)).toEqual(['titles', 'nijiiroId'])
    expect(review.facts.map((l) => [l.label, l.from, l.to])).toEqual([
      [{ field: 'demo' }, '20–30', '10–25'],
      [{ field: 'maker', slot: 'Oni' }, 'B', 'A'],
    ])
  })
})

describe('replacementFields', () => {
  const preview = { metadata: file(), previous: file(), blocks }
  it('sends kept fields back as the chart has them', () => {
    expect(
      replacementFields(chart, preview, proposal, new Set(['titles', 'demo', 'maker:Oni'])),
    ).toEqual({
      keepTitles: true,
      description: 'About',
      categoryIds: ['variety'],
      nijiiroId: '',
      officialId: '',
      demoStart: 20,
      demoEnd: 30,
      difficultyMakers: [
        { course: 'Hard', side: 'single', maker: 'A' },
        { course: 'Oni', side: 'single', maker: 'B' },
      ],
    })
  })
  it('sends the new values otherwise', () => {
    expect(replacementFields(chart, preview, proposal, new Set())).toMatchObject({
      keepTitles: false,
      demoStart: 10,
      demoEnd: 25,
      difficultyMakers: [
        { course: 'Hard', side: 'single', maker: 'A' },
        { course: 'Oni', side: 'single', maker: 'A' },
      ],
    })
  })
})
