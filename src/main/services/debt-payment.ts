export interface DebtPaymentBreakdown {
  amount: number
  principal: number
  interest: number
  fee: number
}

function round(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100
}

export function normalizeDebtPaymentBreakdown(
  amountInput: number,
  remainingInput: number,
  principalInput?: number,
  interestInput?: number,
  feeInput?: number
): DebtPaymentBreakdown {
  const amount = round(amountInput)
  const remaining = round(Math.max(0, remainingInput))
  const interest = round(Math.max(0, Number(interestInput) || 0))
  const fee = round(Math.max(0, Number(feeInput) || 0))
  const principal = round(principalInput == null ? amount - interest - fee : principalInput)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment must be greater than zero.')
  if (principal <= 0 || round(principal + interest + fee) !== amount) throw new Error('Principal, interest, and fee must add up to the payment amount.')
  if (principal > remaining) throw new Error(`Principal cannot exceed the remaining debt of ${remaining}.`)
  return { amount, principal, interest, fee }
}
