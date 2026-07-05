import { getDatabase } from '../database-encrypted'

interface SchedulerConfig {
  enabled: boolean
  intervalHours: number
}

const DEFAULT_CONFIG: SchedulerConfig = { enabled: true, intervalHours: 24 }

let intervalId: ReturnType<typeof setInterval> | null = null

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
    ).all(today) as Array<{ id: number; name: string; amount: number; frequency: string; next_billing_date: string }>

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

    for (const sub of due) {
      const existingTx = db.prepare(
        `SELECT id FROM transactions WHERE description = ? AND date = ? AND amount = ? AND type = 'expense'`
      ).get(sub.name, sub.next_billing_date, sub.amount) as { id: number } | undefined

      if (!existingTx) {
        db.prepare(
          `INSERT INTO transactions (description, amount, type, date, is_recurring)
           VALUES (?, ?, 'expense', ?, 1)`
        ).run(sub.name, sub.amount, sub.next_billing_date)
      }

      let nextDate = sub.next_billing_date
      for (let i = 0; i < 12; i++) {
        nextDate = advanceDate(nextDate, sub.frequency)
        if (nextDate > today) break
      }
      db.prepare('UPDATE subscriptions SET next_billing_date = ? WHERE id = ?').run(nextDate, sub.id)
    }

    const savingsSources = db.prepare('SELECT * FROM savings_sources').all() as Array<{
      id: number; description: string; amount: number; category_id: number | null
    }>

    for (const source of savingsSources) {
      const existing = db.prepare(
        `SELECT id FROM transactions WHERE notes LIKE ? AND strftime('%Y', date) = ? AND strftime('%m', date) = ?`
      ).get(`%savings_source:${source.id}%`, String(year), String(month).padStart(2, '0')) as { id: number } | undefined

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
        db.prepare(
          `INSERT INTO transactions (description, amount, type, category_id, date, notes)
           VALUES (?, ?, 'savings', ?, ?, ?)`
        ).run(source.description, source.amount, catId, today, `savings_source:${source.id}`)
      }
    }

    const incomeSources = db.prepare('SELECT * FROM income_sources WHERE is_recurring = 1').all() as Array<{
      id: number; name: string; amount: number; frequency: string
    }>

    for (const source of incomeSources) {
      const existingEntry = db.prepare(
        'SELECT id FROM income_entries WHERE source_id = ? AND year = ? AND month = ?'
      ).get(source.id, year, month) as { id: number } | undefined

      if (!existingEntry) {
        const occurrences = source.frequency === 'weekly' ? 4 : source.frequency === 'fortnightly' ? 2 : 1
        const monthlyAmount = Math.round(source.amount * occurrences * 100) / 100
        db.prepare(
          `INSERT INTO transactions (description, amount, type, date, notes)
           VALUES (?, ?, 'income', ?, ?)`
        ).run(source.name, monthlyAmount, today, `income_source:${source.id}`)
        db.prepare(
          'INSERT OR IGNORE INTO income_entries (source_id, year, month, amount, is_irregular) VALUES (?, ?, ?, ?, 0)'
        ).run(source.id, year, month, monthlyAmount)
      }
    }
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
