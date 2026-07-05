import { getDatabase } from '../database-encrypted'

export interface ExchangeRates {
  base: string
  rates: Record<string, number>
  fetchedAt: string
}

function getProfileBase(): string {
  try {
    const db = getDatabase()
    const row = db.prepare("SELECT value FROM settings WHERE key = 'profile'").get() as
      | { value: string }
      | undefined
    if (row) {
      const profile = JSON.parse(row.value) as { baseCurrency?: string }
      return profile.baseCurrency || 'SEK'
    }
  } catch {
    // ignore
  }
  return 'SEK'
}

export async function fetchExchangeRates(): Promise<ExchangeRates> {
  const base = getProfileBase()
  const targets = ['EUR', 'USD', 'GBP', 'NOK', 'DKK', 'CHF', 'JPY', 'CAD', 'AUD']
    .filter((c) => c !== base)
    .join(',')
  const url = `https://api.frankfurter.app/latest?from=${base}&to=${targets}`
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error('Failed to fetch rates')
    const data = (await res.json()) as { base: string; rates: Record<string, number>; date: string }
    const rates: ExchangeRates = {
      base: data.base,
      rates: { [base]: 1, ...data.rates },
      fetchedAt: new Date().toISOString()
    }
    cacheRates(rates)
    return rates
  } catch {
    return getCachedRates(base) ?? getDefaultRates(base)
  }
}

function cacheRates(rates: ExchangeRates): void {
  const db = getDatabase()
  db.prepare(
    'INSERT OR REPLACE INTO currency_cache (base, rates, fetched_at) VALUES (?, ?, ?)'
  ).run(rates.base, JSON.stringify(rates.rates), rates.fetchedAt)
}

export function getCachedRates(base?: string): ExchangeRates | null {
  const b = base || getProfileBase()
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM currency_cache WHERE base = ?').get(b) as
    | { base: string; rates: string; fetched_at: string }
    | undefined
  if (!row) return null
  return {
    base: row.base,
    rates: JSON.parse(row.rates) as Record<string, number>,
    fetchedAt: row.fetched_at
  }
}

function getDefaultRates(base: string): ExchangeRates {
  const defaults: Record<string, number> = {
    EUR: 0.088, USD: 0.095, GBP: 0.075,
    NOK: 1.02, DKK: 0.65, CHF: 0.085,
    JPY: 14.5, CAD: 0.13, AUD: 0.14
  }
  return {
    base,
    rates: { [base]: 1, ...defaults },
    fetchedAt: new Date().toISOString()
  }
}

export function convertAmount(
  amountBase: number,
  fromCurrency: string,
  toCurrency: string,
  rates: Record<string, number>
): number {
  if (fromCurrency === toCurrency) return amountBase
  const fromRate = rates[fromCurrency]
  const toRate = rates[toCurrency]
  if (!fromRate || !toRate) return amountBase
  return (amountBase / fromRate) * toRate
}
