import { describe, expect, it } from 'vitest'
import { createUnlockRateLimiter } from '../unlock-rate-limiter'

describe('unlock rate limiter', () => {
  it('keeps the full lockout even after the attempt window has elapsed', () => {
    const limiter = createUnlockRateLimiter(5, 60_000, 300_000)
    for (let index = 0; index < 5; index++) limiter.recordFailure(index * 1000)
    expect(limiter.remainingSeconds(61_000)).toBe(243)
    expect(limiter.remainingSeconds(304_000)).toBe(0)
  })

  it('clears failures after a successful unlock', () => {
    const limiter = createUnlockRateLimiter(2, 60_000, 300_000)
    limiter.recordFailure(0)
    limiter.reset()
    limiter.recordFailure(1_000)
    expect(limiter.remainingSeconds(2_000)).toBe(0)
  })
})
