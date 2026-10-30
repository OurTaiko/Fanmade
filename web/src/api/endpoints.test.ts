import { expect, it } from 'vitest'
import { endpoints } from './endpoints'

it('encodes the chart ID in the resources address', () => {
  const id = '曲目/a?b#c'
  expect(endpoints.resources(id)).toBe(`/api/v1/charts/${encodeURIComponent(id)}/resources`)
})
