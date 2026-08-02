import { describe, expect, it } from 'vitest'
import { normalizeDebtPaymentBreakdown } from '../debt-payment'

describe('debt payment breakdown', () => {
  it('separates principal, interest, and fees without reducing debt by the full bank transaction', () => {
    expect(normalizeDebtPaymentBreakdown(1200, 10000, 900, 250, 50)).toEqual({ amount: 1200, principal: 900, interest: 250, fee: 50 })
  })

  it('uses the complete payment as principal for legacy manual payments', () => {
    expect(normalizeDebtPaymentBreakdown(750, 1000)).toEqual({ amount: 750, principal: 750, interest: 0, fee: 0 })
  })

  it('rejects invalid totals and principal above the remaining balance', () => {
    expect(() => normalizeDebtPaymentBreakdown(1000, 500, 800, 100, 50)).toThrow(/add up/)
    expect(() => normalizeDebtPaymentBreakdown(1000, 500, 900, 100, 0)).toThrow(/remaining debt/)
  })
})
