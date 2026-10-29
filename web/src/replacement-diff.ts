// What a replacement of a chart's files changes, for the review before it is
// sent. The same file is in Fanmade and OurTaikoDatabase, so it imports
// nothing of either site; keep the two copies identical.

type Side = 'single' | 'p1' | 'p2'
type Texts = Partial<Record<string, string>>
type Named = {
  title: string
  subtitle: string
  titleTranslations?: Texts
  subtitleTranslations?: Texts
}
type Block = { course: string; side: Side; level: number; maker: string }
/** A TJA as the server reads it. */
export type FileReading = Named & {
  bpm: number
  offset: number
  demoStart: number
  movieOffset?: number
  difficulties: (Block & { chartHash?: string | null })[]
}
/** The chart as the site has it. */
export type CurrentChart = Named & {
  bpm: number
  offset: number
  demoStart: number
  demoEnd?: number
  movieOffset?: number
  description: string
  categoryIds: string[]
  nijiiroId?: number | null
  officialId?: string | null
  difficulties: Block[]
  audioHash: string
  audioSize: number
}

/** One course×side slot as the server reads the new file against the stored one. */
export type ReplacementBlock = {
  course: string
  side: Side
  change: 'same' | 'changed' | 'added' | 'removed'
  /** The slot's current leaderboard scores. */
  scores: number
}
/** POST /charts/{id}/files/preview: the new file as the replacement reads it, and the stored file. */
export type ReplacementPreview = {
  metadata: FileReading
  /** The stored file's own reading; null when there is none or it can no longer be read. */
  previous: FileReading | null
  blocks: ReplacementBlock[]
}

/** What a page would send before anything is kept. */
export type Proposal = {
  description: string
  categoryIds: string[]
  /** Database's identifiers as typed; Fanmade has none. */
  nijiiroId?: string
  officialId?: string
  demoStart: number
  demoEnd: number
  /** Makers typed on the page, by slot; a slot left out takes the new file's. */
  typedMakers: Record<string, string>
  /** The preview range was typed on the page rather than taken from the file. */
  typedDemo: boolean
}
/**
 * Which of the file's values the site edits on its own and the replacement
 * can spare (Fanmade); where false they follow the file (Database).
 */
export type Editable = { demo: boolean; makers: boolean }

export type Line = { label: LineLabel; from: string; to: string }
export type LineLabel =
  | { field: 'title' | 'subtitle'; locale?: string }
  | {
      field:
        | 'demo'
        | 'description'
        | 'categories'
        | 'nijiiroId'
        | 'officialId'
        | 'bpm'
        | 'offset'
        | 'movieOffset'
    }
  | { field: 'maker'; slot: string }
/**
 * A change the chart can be spared: its current value is a site field the
 * metadata editor also sets. keep starts true when the new file says what the
 * stored file said, so the difference is only a site edit.
 */
export type KeepableChange = { key: string; lines: Line[]; keep: boolean }
export type BlockChange = {
  /** The course, with _1p or _2p for a #START P1 / P2 block. */
  slot: string
  course: string
  side: Side
  change: ReplacementBlock['change']
  from?: number
  to?: number
  scores: number
  /** What happens to the slot's leaderboard scores. */
  effect: 'none' | 'retire' | 'delete' | 'new'
}
export type Review = {
  keepable: KeepableChange[]
  /** Values only the file sets. */
  facts: Line[]
  blocks: BlockChange[]
}

export const slotOf = (d: { course: string; side: Side }) =>
  d.course + (d.side === 'p1' ? '_1p' : d.side === 'p2' ? '_2p' : '')
const translationKeys = ['en', 'ja', 'zh', 'zh_tw', 'ko'] as const
const text = (value: string | null | undefined) => value?.trim() ?? ''
const demoText = (start: number, end: number) => `${start}–${end}`

function titleLines(from: Named, to: Named): Line[] {
  const lines: Line[] = []
  for (const field of ['title', 'subtitle'] as const) {
    const key = field === 'title' ? 'titleTranslations' : 'subtitleTranslations'
    if (text(from[field]) !== text(to[field]))
      lines.push({ label: { field }, from: text(from[field]), to: text(to[field]) })
    for (const locale of translationKeys) {
      const before = text(from[key]?.[locale]),
        after = text(to[key]?.[locale])
      if (before !== after) lines.push({ label: { field, locale }, from: before, to: after })
    }
  }
  return lines
}

/**
 * Compares the chart as it is with what a replacement would make of it: the
 * site fields it would overwrite (each can be kept), the values only the file
 * sets, and every block with what happens to its scores. audioChanged retires
 * every block's scores, as the server does when the audio's content differs.
 */
export function reviewReplacement(
  chart: CurrentChart,
  preview: ReplacementPreview,
  proposal: Proposal,
  audioChanged: boolean,
  editable: Editable,
): Review {
  const next = preview.metadata,
    previous = preview.previous
  const keepable: KeepableChange[] = []
  const facts: Line[] = []
  const titles = titleLines(chart, next)
  if (titles.length)
    keepable.push({
      key: 'titles',
      lines: titles,
      keep: !!previous && titleLines(previous, next).length === 0,
    })
  const typedDemo = editable.demo && proposal.typedDemo
  const demoStart = typedDemo ? proposal.demoStart : next.demoStart
  const demoEnd = typedDemo ? proposal.demoEnd : next.demoStart + 15
  const currentEnd = chart.demoEnd ?? chart.demoStart + 15
  if (demoStart !== chart.demoStart || demoEnd !== currentEnd) {
    const line: Line = {
      label: { field: 'demo' },
      from: demoText(chart.demoStart, currentEnd),
      to: demoText(demoStart, demoEnd),
    }
    if (editable.demo)
      keepable.push({
        key: 'demo',
        lines: [line],
        keep: !typedDemo && previous?.demoStart === next.demoStart,
      })
    else facts.push(line)
  }
  const typed = (key: 'description' | 'nijiiroId' | 'officialId', from: string, to?: string) => {
    if (to !== undefined && text(from) !== text(to))
      keepable.push({ key, lines: [{ label: { field: key }, from, to }], keep: false })
  }
  typed('description', chart.description, proposal.description)
  const sorted = (ids: string[]) => [...ids].sort().join(',')
  if (sorted(proposal.categoryIds) !== sorted(chart.categoryIds))
    keepable.push({
      key: 'categories',
      lines: [
        {
          label: { field: 'categories' },
          from: chart.categoryIds.join(','),
          to: proposal.categoryIds.join(','),
        },
      ],
      keep: false,
    })
  typed('nijiiroId', chart.nijiiroId != null ? String(chart.nijiiroId) : '', proposal.nijiiroId)
  typed('officialId', chart.officialId ?? '', proposal.officialId)
  for (const d of next.difficulties) {
    const slot = slotOf(d)
    const current = chart.difficulties.find((c) => slotOf(c) === slot)
    if (!current) continue
    const typedMaker = editable.makers && Object.hasOwn(proposal.typedMakers, slot)
    const maker = typedMaker ? proposal.typedMakers[slot] : d.maker
    if (text(maker) === text(current.maker)) continue
    const line: Line = { label: { field: 'maker', slot }, from: current.maker, to: maker }
    const before = previous?.difficulties.find((p) => slotOf(p) === slot)
    if (editable.makers)
      keepable.push({
        key: `maker:${slot}`,
        lines: [line],
        keep: !typedMaker && !!before && text(before.maker) === text(d.maker),
      })
    else facts.push(line)
  }

  for (const field of ['bpm', 'offset', 'movieOffset'] as const) {
    const before = chart[field] ?? 0,
      after = next[field] ?? 0
    if (before !== after) facts.push({ label: { field }, from: String(before), to: String(after) })
  }

  const blocks = preview.blocks.map((b): BlockChange => {
    const slot = slotOf(b)
    const effect =
      b.change === 'added'
        ? 'new'
        : b.change === 'removed'
          ? 'delete'
          : b.change === 'changed' || audioChanged
            ? 'retire'
            : 'none'
    return {
      slot,
      course: b.course,
      side: b.side,
      change: b.change,
      from: chart.difficulties.find((c) => slotOf(c) === slot)?.level,
      to: next.difficulties.find((d) => slotOf(d) === slot)?.level,
      scores: b.scores,
      effect,
    }
  })
  return { keepable, facts, blocks }
}

/**
 * The fields a replacement sends once the chosen changes are kept: kept site
 * fields go back as the chart has them, the titles by keepTitles.
 */
export function replacementFields(
  chart: CurrentChart,
  preview: ReplacementPreview,
  proposal: Proposal,
  kept: ReadonlySet<string>,
) {
  const next = preview.metadata
  const demo = kept.has('demo')
    ? { start: chart.demoStart, end: chart.demoEnd ?? chart.demoStart + 15 }
    : proposal.typedDemo
      ? { start: proposal.demoStart, end: proposal.demoEnd }
      : { start: next.demoStart, end: next.demoStart + 15 }
  return {
    keepTitles: kept.has('titles'),
    description: kept.has('description') ? chart.description : proposal.description,
    categoryIds: kept.has('categories') ? chart.categoryIds : proposal.categoryIds,
    nijiiroId: kept.has('nijiiroId')
      ? chart.nijiiroId != null
        ? String(chart.nijiiroId)
        : ''
      : (proposal.nijiiroId ?? ''),
    officialId: kept.has('officialId') ? (chart.officialId ?? '') : (proposal.officialId ?? ''),
    demoStart: demo.start,
    demoEnd: demo.end,
    difficultyMakers: next.difficulties.map((d) => {
      const slot = slotOf(d)
      const current = chart.difficulties.find((c) => slotOf(c) === slot)
      const maker =
        current && kept.has(`maker:${slot}`)
          ? current.maker
          : Object.hasOwn(proposal.typedMakers, slot)
            ? proposal.typedMakers[slot]
            : d.maker
      return { course: d.course, side: d.side, maker }
    }),
  }
}

/** Whether the selected audio differs from the chart's, by content; true where it cannot be hashed. */
export async function audioDiffers(chart: CurrentChart, audio: File | null) {
  if (!audio) return false
  if (audio.size !== chart.audioSize || !crypto.subtle) return true
  const digest = await crypto.subtle.digest('SHA-256', await audio.arrayBuffer())
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  return hex !== chart.audioHash
}
