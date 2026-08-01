import { getDatabase } from '../database-encrypted'

export function isMonthClosed(date: string): boolean {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(date)
  if (!match) return false
  try {
    const row = getDatabase()
      .prepare('SELECT 1 FROM closed_months WHERE year = ? AND month = ?')
      .get(Number(match[1]), Number(match[2]))
    return Boolean(row)
  } catch (error) {
    if (error instanceof Error && error.message.includes('closed_months')) return false
    throw error
  }
}

export function assertMonthOpen(date: string): void {
  if (isMonthClosed(date)) {
    throw new Error(`Month ${date.slice(0, 7)} is closed. Reopen it in Settings before changing transactions.`)
  }
}

export function assertYearMonthOpen(year: number, month: number): void {
  assertMonthOpen(`${year}-${String(month).padStart(2, '0')}-01`)
}
