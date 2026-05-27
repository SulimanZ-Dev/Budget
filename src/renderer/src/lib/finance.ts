export type IncomeFrequency = 'weekly' | 'fortnightly' | 'monthly' | 'yearly'

export interface IncomeSourceRow {
  id: number
  amount: number
  is_gross?: number
  gross_or_net?: 'gross' | 'net'
  is_recurring?: number
  frequency?: IncomeFrequency
}

const MONTHS_PER_YEAR = 12

export function roundCurrency(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

export function frequencyToMonthly(amount: number, frequency: IncomeFrequency = 'monthly'): number {
  switch (frequency) {
    case 'weekly':
      return roundCurrency((amount * 52) / MONTHS_PER_YEAR)
    case 'fortnightly':
      return roundCurrency((amount * 26) / MONTHS_PER_YEAR)
    case 'yearly':
      return roundCurrency(amount / MONTHS_PER_YEAR)
    default:
      return roundCurrency(amount)
  }
}

export function monthlySubscriptionCost(amount: number, frequency: string): number {
  if (frequency === 'annual' || frequency === 'yearly') {
    return roundCurrency(amount / MONTHS_PER_YEAR)
  }
  return roundCurrency(amount)
}

export function netFromGross(gross: number, taxPercent: number): number {
  const safeTax = Math.min(100, Math.max(0, Number.isFinite(taxPercent) ? taxPercent : 0))
  return roundCurrency(gross * (1 - safeTax / 100))
}

export function grossFromNet(net: number, taxPercent: number): number {
  const safeTax = Math.min(99.99, Math.max(0, Number.isFinite(taxPercent) ? taxPercent : 0))
  const divisor = 1 - safeTax / 100
  return divisor <= 0 ? net : roundCurrency(net / divisor)
}
