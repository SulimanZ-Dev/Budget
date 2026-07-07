import { describe, expect, it } from 'vitest'
import { __databaseTesting } from '../database'

class FakeSettingsDb {
  profile = ''

  prepare(sql: string): { get: () => { value: string } | undefined; run: (value: string) => void } {
    if (sql.includes("SELECT value FROM settings WHERE key = 'profile'")) {
      return {
        get: () => (this.profile ? { value: this.profile } : undefined),
        run: () => undefined
      }
    }
    if (sql.includes("UPDATE settings SET value = ? WHERE key = 'profile'")) {
      return {
        get: () => undefined,
        run: (value: string) => {
          this.profile = value
        }
      }
    }
    throw new Error(`Unhandled SQL: ${sql}`)
  }
}

describe('profile database migration', () => {
  it('backfills missing profile defaults without overwriting existing values', () => {
    const db = new FakeSettingsDb()
    db.profile = JSON.stringify({ name: 'Ada', currency: 'EUR' })

    __databaseTesting.backfillProfileDefaults(db as any)
    const profile = JSON.parse(db.profile) as Record<string, unknown>

    expect(profile.name).toBe('Ada')
    expect(profile.currency).toBe('EUR')
    expect(profile.baseCurrency).toBe('SEK')
    expect(profile.savingsRateTarget).toBe(20)
    expect(profile.colorBlindMode).toBe(false)
    expect(profile.locale).toBe('sv-SE')
  })

  it('keeps the profile unchanged when all defaults are already present', () => {
    const db = new FakeSettingsDb()
    const completeProfile = { ...__databaseTesting.getProfileDefaults(), name: 'Complete' }
    db.profile = JSON.stringify(completeProfile)

    __databaseTesting.backfillProfileDefaults(db as any)

    expect(JSON.parse(db.profile)).toEqual(completeProfile)
  })
})
