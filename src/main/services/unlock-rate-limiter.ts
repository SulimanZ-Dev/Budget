export function createUnlockRateLimiter(maxAttempts: number, attemptWindowMs: number, lockoutDurationMs: number): {
  remainingSeconds(now: number): number
  recordFailure(now: number): void
  reset(): void
} {
  const attempts: number[] = []
  let lockoutUntil = 0

  function prune(now: number): void {
    while (attempts.length > 0 && attempts[0] < now - attemptWindowMs) attempts.shift()
  }

  return {
    remainingSeconds(now) {
      if (lockoutUntil > now) return Math.ceil((lockoutUntil - now) / 1000)
      if (lockoutUntil > 0) {
        lockoutUntil = 0
        attempts.length = 0
      }
      prune(now)
      return 0
    },
    recordFailure(now) {
      prune(now)
      attempts.push(now)
      if (attempts.length >= maxAttempts) lockoutUntil = now + lockoutDurationMs
    },
    reset() {
      attempts.length = 0
      lockoutUntil = 0
    }
  }
}
