import { getDatabase } from '../database-encrypted'
import { createTransaction } from '../commands/transaction-commands'

interface SchedulerConfig {
  enabled: boolean
  intervalHours: number
}

const DEFAULT_CONFIG: SchedulerConfig = { enabled: true, intervalHours: 24 }

let intervalId: ReturnType<typeof setInterval> | null = null

function getPrimaryAccountId(): number {
  const db = getDatabase()
  const existing = db.prepare("SELECT id FROM accounts WHERE is_archived = 0 ORDER BY id LIMIT 1").get() as { id: number } | undefined
  if (existing) return existing.id
  const result = db.prepare("INSERT INTO accounts (name, type, currency, is_archived) VALUES ('Main', 'checking', 'SEK', 0)").run()
  return Number(result.lastInsertRowid)
}

function normalizeAccountId(accountId: number | null | undefined): number {
  if (typeof accountId === 'number') {
    const account = getDatabase().prepare('SELECT id FROM accounts WHERE id = ? AND is_archived = 0').get(accountId) as { id: number } | undefined
    if (account) return account.id
  }
  return getPrimaryAccountId()
}

function runBillingChecks(): void {
  const db = getDatabase()
  if (!db) return

  try {
    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    const year = now.getFullYear()
    const month = now.getMonth() + 1

    const due = db.prepare(
      `SELECT * FROM subscriptions WHERE next_billing_date IS NOT NULL AND next_billing_date <= ?`
    ).all(today) as Array<{ id: number; name: string; amount: number; frequency: string; next_billing_date: string; account_id: number | null }>

    function advanceDate(dateStr: string, frequency: string): string {
      const [y, m, d] = dateStr.split('-').map(Number)
      if (frequency === 'yearly') return `${y + 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      if (frequency === 'weekly') {
        const dt = new Date(y, m - 1, d + 7)
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
      }
      if (frequency === 'fortnightly') {
        const dt = new Date(y, m - 1, d + 14)
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
      }
      return addMonthsFallback(dateStr, 1)
    }

    function addMonthsFallback(dateStr: string, n: number): string {
      const [y, m, d] = dateStr.split('-').map(Number)
      const totalMonths = y * 12 + (m - 1) + n
      const ny = Math.floor(totalMonths / 12)
      const nm = (totalMonths % 12) + 1
      const nd = Math.min(d, new Date(ny, nm, 0).getDate())
      return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`
    }

    // Run all billing checks within a single transaction for atomicity
    const tx = db.transaction(() => {
      for (const sub of due) {
        // Check if a transaction already exists for this billing period using notes marker
        const existingTx = db.prepare(
          `SELECT id FROM transactions WHERE notes = ? AND date = ? AND type = 'expense'`
        ).get(`subscription:${sub.id}`, sub.next_billing_date) as { id: number } | undefined

        if (!existingTx) {
          // Store subscription reference in notes to prevent duplicates on name change
          createTransaction({
            description: sub.name,
            amount: sub.amount,
            type: 'expense',
            account_id: normalizeAccountId(sub.account_id),
            date: sub.next_billing_date,
            is_recurring: true,
            notes: `subscription:${sub.id}`
          })
        }

        // Advance next_billing_date by frequency — keep advancing if still past due
        let nextDate = sub.next_billing_date
        for (let i = 0; i < 12; i++) {
          nextDate = advanceDate(nextDate, sub.frequency)
          if (nextDate > today) break
        }
        db.prepare(
          'UPDATE subscriptions SET next_billing_date = ? WHERE id = ?'
        ).run(nextDate, sub.id)
      }

      const savingsSources = db.prepare('SELECT * FROM savings_sources').all() as Array<{
        id: number; description: string; amount: number; category_id: number | null; account_id: number | null
      }>

      for (const source of savingsSources) {
        const noteMarker = `savings_source:${source.id}`
        const existing = db.prepare(
          `SELECT id FROM transactions WHERE notes LIKE ? AND strftime('%Y', date) = ? AND strftime('%m', date) = ?`
        ).get(`%${noteMarker}%`, String(year), String(month).padStart(2, '0')) as { id: number } | undefined

        if (!existing) {
          let catId = source.category_id
          if (catId) {
            const catExists = db.prepare('SELECT 1 FROM categories WHERE id = ?').get(catId)
            if (!catExists) {
              const defaultCat = db.prepare("SELECT id FROM categories WHERE goal_type = 'savings' LIMIT 1").get() as { id: number } | undefined
              catId = defaultCat?.id ?? null
            }
          }
          if (!catId) {
            const defaultCat = db.prepare("SELECT id FROM categories WHERE goal_type = 'savings' LIMIT 1").get() as { id: number } | undefined
            catId = defaultCat?.id ?? null
          }
          createTransaction({
            description: source.description,
            amount: source.amount,
            type: 'savings',
            account_id: normalizeAccountId(source.account_id),
            category_id: catId,
            date: today,
            notes: noteMarker
          })
        }
      }

      const incomeSources = db.prepare('SELECT * FROM income_sources WHERE is_recurring = 1').all() as Array<{
        id: number; name: string; amount: number; frequency: string; account_id: number | null; next_billing_date?: string | null
      }>

      for (const source of incomeSources) {
        const billingDate = source.next_billing_date || today
        if (billingDate > today) continue
        const billing = {
          year: Number(billingDate.slice(0, 4)),
          month: Number(billingDate.slice(5, 7))
        }
        const existingEntry = db.prepare(
          'SELECT id FROM income_entries WHERE source_id = ? AND year = ? AND month = ?'
        ).get(source.id, billing.year, billing.month) as { id: number } | undefined

        if (!existingEntry) {
          const occurrences = source.frequency === 'weekly' ? 4 : source.frequency === 'fortnightly' ? 2 : 1
          const monthlyAmount = Math.round(Math.abs(source.amount) * occurrences * 100) / 100
          createTransaction({
            description: source.name,
            amount: monthlyAmount,
            type: 'income',
            account_id: normalizeAccountId(source.account_id),
            date: billingDate,
            notes: `income_source:${source.id}`
          })
          db.prepare(
            'INSERT OR IGNORE INTO income_entries (source_id, year, month, amount, is_irregular) VALUES (?, ?, ?, ?, 0)'
          ).run(source.id, billing.year, billing.month, monthlyAmount)
        }

        db.prepare('UPDATE income_sources SET next_billing_date = ? WHERE id = ?')
          .run(advanceDate(billingDate, source.frequency), source.id)
      }
    })

    tx()
  } catch (error) {
    console.error('Scheduler billing check failed:', error)
  }
}

export function getSchedulerConfig(): SchedulerConfig {
  const db = getDatabase()
  if (!db) return { ...DEFAULT_CONFIG }
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'schedulerConfig'").get() as { value: string } | undefined
    if (row) return { ...DEFAULT_CONFIG, ...JSON.parse(row.value) }
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG }
}

export function setSchedulerConfig(config: SchedulerConfig): void {
  const db = getDatabase()
  if (!db) return
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('schedulerConfig', ?)").run(JSON.stringify(config))
  restart(config)
}

export function start(config?: SchedulerConfig): void {
  const cfg = config ?? getSchedulerConfig()
  if (intervalId) clearInterval(intervalId)
  intervalId = null
  if (!cfg.enabled) return
  runBillingChecks()
  intervalId = setInterval(runBillingChecks, cfg.intervalHours * 3600000)
}

export function stop(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

export function restart(config?: SchedulerConfig): void {
  stop()
  start(config)
}
