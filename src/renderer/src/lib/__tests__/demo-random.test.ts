import { describe, expect, it } from 'vitest'
import { createSeededRandom } from '../demo-random'

describe('demo scenario random generator', () => {
  it('replays the exact same sequence for the same seed', () => {
    const first = createSeededRandom(20260802)
    const replay = createSeededRandom(20260802)
    expect(Array.from({ length: 20 }, first)).toEqual(Array.from({ length: 20 }, replay))
  })

  it('creates a different sequence for a different seed', () => {
    const first = createSeededRandom(1)
    const second = createSeededRandom(2)
    expect(Array.from({ length: 5 }, first)).not.toEqual(Array.from({ length: 5 }, second))
  })
})
