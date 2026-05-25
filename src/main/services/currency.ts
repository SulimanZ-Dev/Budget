import { getDatabase } from '../database'

const FRANKFURTER_URL = 'https://api.frankfurter.app/latest?from=SEK&to=EUR,USD'

export interface ExchangeRates {
  base: string
  rates: Record<string, number>
  fetchedAt: string
}

export async function fetchExchangeRates(): Promise<ExchangeRates> {
  try {
    const res = await fetch(FRANKFURTER_URL)
    if (!res.ok) throw new Error('Failed to fetch rates')
    const data = (await res.json()) as { base: string; rates: Record<string, number>; date: string }
    const rates: ExchangeRates = {
      base: data.base,
      rates: { SEK: 1, ...data.rates },
      fetchedAt: new Date().toISOString()
    }
    cacheRates(rates)
    return rates
  } catch {
    return getCachedRates() ?? getDefaultRates()
  }
}

function cacheRates(rates: ExchangeRates): void {
  const db = getDatabase()
  db.prepare(
    `INSERT OR REPLACE INTO currency_cache (base, rates, fetched_at) VALUES (?, ?, ?)`
  ).run(rates.base, JSON.stringify(rates.rates), rates.fetchedAt)
}

export function getCachedRates(): ExchangeRates | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM currency_cache WHERE base = ?').get('SEK') as
    | { base: string; rates: string; fetched_at: string }
    | undefined
  if (!row) return null
  return {
    base: row.base,
    rates: JSON.parse(row.rates) as Record<string, number>,
    fetchedAt: row.fetched_at
  }
}

function getDefaultRates(): ExchangeRates {
  return {
    base: 'SEK',
    rates: { SEK: 1, EUR: 0.088, USD: 0.095 },
    fetchedAt: new Date().toISOString()
  }
}

export function convertAmount(
  amountSek: number,
  toCurrency: string,
  rates: Record<string, number>
): number {
  if (toCurrency === 'SEK') return amountSek
  const rate = rates[toCurrency]
  if (!rate) return amountSek
  return amountSek * rate
}
