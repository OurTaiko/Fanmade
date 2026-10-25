import { describe, expect, it } from 'vitest'
import { hasConstants } from './chart-difficulty'
import type { Difficulty } from './tja'

const block = (constants?: Difficulty['constants']): Difficulty => ({
  course: 'Oni',
  side: 'single',
  level: 10,
  maker: '',
  constants,
})

describe('hasConstants', () => {
  it('shows the panel when any block is rated', () => {
    const rated = {
      route: 'unbranched' as const,
      mainConstant: 10,
      subConstant75: 9,
      subConstant99: 11,
      stamina: 1,
      handspeed: 2,
      burst: 3,
      complex: 4,
      rhythm: 5,
    }
    expect(hasConstants([block(), block([rated])])).toBe(true)
  })
  it('leaves it out when none is (an older server, or not rated yet)', () => {
    expect(hasConstants([block(), block([])])).toBe(false)
  })
})
