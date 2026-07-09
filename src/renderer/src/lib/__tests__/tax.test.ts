import { describe, expect, it } from 'vitest'
import { calculateTaxReconciledYtd, parseOptionalTaxAmount } from '../tax'

describe('tax reconciliation math', () => {
  it('subtracts the full expected yearly tax owed from the current monthly sum', () => {
    expect(calculateTaxReconciledYtd(500, 12000)).toBe(-11500)
  })

  it('recomputes from the raw monthly sum when the expected amount changes', () => {
    expect(calculateTaxReconciledYtd(500, 12000)).toBe(-11500)
    expect(calculateTaxReconciledYtd(500, 9000)).toBe(-8500)
  })

  it('keeps remaining refund when overpayment exceeds expected yearly tax owed', () => {
    expect(calculateTaxReconciledYtd(14000, 12000)).toBe(2000)
  })

  it('returns the raw monthly sum when the optional field is empty', () => {
    expect(parseOptionalTaxAmount('')).toBeNull()
    expect(calculateTaxReconciledYtd(500, parseOptionalTaxAmount(''))).toBe(500)
  })
})
