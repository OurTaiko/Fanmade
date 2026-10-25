import type { Difficulty } from './tja'
import { slotKey } from './courses'

/** The block shown first, as its slot key: the hardest course, single before 1P and 2P. */
export function defaultDifficulty(difficulties: Difficulty[]): string {
  return (
    ['Oni', 'Edit', 'Hard', 'Normal', 'Easy']
      .flatMap((base) => [base, `${base}_1p`, `${base}_2p`])
      .find((key) => difficulties.some((d) => slotKey(d) === key)) ?? ''
  )
}

/** Whether any block of the chart has difficulty constants, so the page can leave the panel out. */
export function hasConstants(difficulties: Difficulty[]): boolean {
  return difficulties.some((d) => (d.constants?.length ?? 0) > 0)
}
