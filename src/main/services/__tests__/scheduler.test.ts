import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, any>

class SchedulerFakeDb {
  accounts: Row[] = []
  transactions: Row[] = []
  subscriptions: Row[] = []
  savingsSources: Row[] = []
  incomeSources: Row[] = []
  incomeEntries: Row[] = []
  categories: Row[] = []
  nextAccountId = 1

  transaction<T extends (...args: any[]) => any>(fn: T): T {
    return ((...args: Parameters<T>) => fn(...args)) as T
  }

  prepare(sql: string): { run: (...args: any[]) => any; get: (...args: any[]) => any; all: (...args: any[]) => any } {
    return {
      run: (...args: any[]) => this.run(sql, args),
      get: (...args: any[]) => this.get(sql, args),
      all: (...args: any[]) => this.all(sql, args)
    }
  }

  private run(sql: string, args: any[]): any {
    if (sql.includes('INSERT INTO accounts')) {
      const row = { id: this.nextAccountId++, name: args[0] ?? 'Main', type: args[1] ?? 'checking', currency: args[2] ?? 'SEK', is_archived: args[3] ?? 0 }
      this.accounts.push(row)
      return { lastInsertRowid: row.id }
    }
    if (sql.includes('INSERT INTO subscriptions')) {
      this.subscriptions.push({ id: args[0], name: args[1], amount: args[2], frequency: args[3], next_billing_date: args[4], account_id: args[5] })
      return { changes: 1 }
    }
    if (sql.includes('INSERT INTO transactions')) {
      this.transactions.push({ description: args[0], amount: args[1], type: args[2], account_id: args[3], date: args[4], notes: args[5] })
      return { changes: 1 }
    }
    if (sql.includes('INSERT INTO savings_sources')) {
      this.savingsSources.push({ id: args[0], description: args[1], amount: args[2], category_id: args[3], account_id: args[4] })
      return { changes: 1 }
    }
    if (sql.includes('INSERT INTO income_sources')) {
      this.incomeSources.push({ id: args[0], name: args[1], amount: args[2], frequency: args[3], is_recurring: args[4], account_id: args[5] })
      return { changes: 1 }
    }
    if (sql.includes('INSERT INTO categories')) {
      this.categories.push({ id: this.categories.length + 1, name: args[0], goal_type: args[1] })
      return { lastInsertRowid: this.categories.length }
    }
    if (sql.startsWith('UPDATE subscriptions SET next_billing_date')) {
      const sub = this.subscriptions.find((row) => row.id === args[1])
      if (sub) sub.next_billing_date = args[0]
      return { changes: sub ? 1 : 0 }
    }
    if (sql.startsWith('UPDATE income_sources SET next_billing_date')) {
      const source = this.incomeSources.find((row) => row.id === args[1])
      if (source) source.next_billing_date = args[0]
      return { changes: source ? 1 : 0 }
    }
    if (sql.includes('INSERT OR IGNORE INTO income_entries')) {
      if (!this.incomeEntries.some((row) => row.source_id === args[0] && row.year === args[1] && row.month === args[2])) {
        this.incomeEntries.push({ source_id: args[0], year: args[1], month: args[2], amount: args[3], is_irregular: args[4] })
      }
      return { changes: 1 }
    }
    if (sql.includes('INSERT OR REPLACE INTO settings')) return { changes: 1 }
    throw new Error(`Unhandled run SQL: ${sql}`)
  }

  private get(sql: string, args: any[]): any {
    if (sql.includes('SELECT id FROM accounts WHERE is_archived = 0')) {
      return this.accounts.find((row) => row.is_archived === 0)
    }
    if (sql.includes('SELECT id FROM accounts WHERE id = ? AND is_archived = 0')) {
      return this.accounts.find((row) => row.id === args[0] && row.is_archived === 0)
    }
    if (sql.includes("SELECT id FROM transactions WHERE notes = ? AND date = ? AND type = 'expense'")) {
      return this.transactions.find((row) => row.notes === args[0] && row.date === args[1] && row.type === 'expense')
    }
    if (sql.includes('SELECT id FROM transactions WHERE notes LIKE ?')) {
      const marker = String(args[0]).replaceAll('%', '')
      const year = String(args[1])
      const month = String(args[2])
      return this.transactions.find((row) => String(row.notes ?? '').includes(marker) && String(row.date).startsWith(`${year}-${month}`))
    }
    if (sql.includes('SELECT 1 FROM categories WHERE id = ?')) {
      return this.categories.some((row) => row.id === args[0]) ? { 1: 1 } : undefined
    }
    if (sql.includes("SELECT id FROM categories WHERE goal_type = 'savings'")) {
      return this.categories.find((row) => row.goal_type === 'savings')
    }
    if (sql.includes('SELECT id FROM income_entries WHERE source_id = ?')) {
      return this.incomeEntries.find((row) => row.source_id === args[0] && row.year === args[1] && row.month === args[2])
    }
    if (sql.includes("SELECT value FROM settings WHERE key = 'schedulerConfig'")) return undefined
    if (sql.includes('SELECT next_billing_date FROM subscriptions WHERE id = 10')) {
      return this.subscriptions.find((row) => row.id === 10)
    }
    throw new Error(`Unhandled get SQL: ${sql}`)
  }

  private all(sql: string, args: any[]): any[] {
    if (sql.includes('FROM subscriptions WHERE next_billing_date')) {
      return this.subscriptions.filter((row) => row.next_billing_date && row.next_billing_date <= args[0])
    }
    if (sql.includes('SELECT * FROM savings_sources')) return this.savingsSources
    if (sql.includes('SELECT * FROM income_sources WHERE is_recurring = 1')) {
      return this.incomeSources.filter((row) => row.is_recurring === 1)
    }
    throw new Error(`Unhandled all SQL: ${sql}`)
  }
}

const schedulerMocks = vi.hoisted(() => ({
  createTransaction: vi.fn(),
  db: { current: null as SchedulerFakeDb | null }
}))

vi.mock('../../database-encrypted', () => ({
  getDatabase: () => schedulerMocks.db.current
}))

vi.mock('../../commands/transaction-commands', () => ({
  createTransaction: schedulerMocks.createTransaction
}))

describe('scheduler billing guards', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-07T12:00:00Z'))
    schedulerMocks.db.current = new SchedulerFakeDb()
    const testDb = schedulerMocks.db.current
    testDb.prepare("INSERT INTO accounts (name, type, currency, is_archived) VALUES ('Main', 'checking', 'SEK', 0)").run()
    testDb.prepare("INSERT INTO accounts (name, type, currency, is_archived) VALUES ('Revolut', 'checking', 'SEK', 0)").run()
    testDb.prepare("INSERT INTO categories (name, goal_type) VALUES ('Savings', 'savings')").run('Savings', 'savings')
    schedulerMocks.createTransaction.mockReset()
  })

  afterEach(async () => {
    const { stop } = await import('../scheduler')
    stop()
    schedulerMocks.db.current = null
    vi.useRealTimers()
    vi.resetModules()
  })

  it('does not create a duplicate subscription transaction for the same notes marker and date', async () => {
    const { start } = await import('../scheduler')
    const testDb = schedulerMocks.db.current!
    testDb
      .prepare('INSERT INTO subscriptions (id, name, amount, frequency, next_billing_date, account_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(10, 'Netflix', 149, 'monthly', '2026-07-07', 2)
    testDb
      .prepare('INSERT INTO transactions (description, amount, type, account_id, date, notes) VALUES (?, ?, ?, ?, ?, ?)')
      .run('Netflix', 149, 'expense', 2, '2026-07-07', 'subscription:10')

    start({ enabled: true, intervalHours: 24 })

    expect(schedulerMocks.createTransaction).not.toHaveBeenCalled()
    const updated = testDb.prepare('SELECT next_billing_date FROM subscriptions WHERE id = 10').get() as { next_billing_date: string }
    expect(updated.next_billing_date).toBe('2026-08-07')
  })

  it('bills due subscriptions with their linked active account', async () => {
    const { start } = await import('../scheduler')
    const testDb = schedulerMocks.db.current!
    testDb
      .prepare('INSERT INTO subscriptions (id, name, amount, frequency, next_billing_date, account_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(11, 'Gym', 299, 'monthly', '2026-07-07', 2)

    start({ enabled: true, intervalHours: 24 })

    expect(schedulerMocks.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Gym',
        amount: 299,
        type: 'expense',
        account_id: 2,
        date: '2026-07-07',
        notes: 'subscription:11'
      })
    )
  })

  it('falls back to the primary account when a recurring source points at an archived account', async () => {
    const { start } = await import('../scheduler')
    const testDb = schedulerMocks.db.current!
    testDb.accounts.push({ id: 3, name: 'Old', type: 'checking', currency: 'SEK', is_archived: 1 })
    testDb.nextAccountId = 4
    testDb
      .prepare('INSERT INTO savings_sources (id, description, amount, category_id, account_id) VALUES (?, ?, ?, ?, ?)')
      .run(20, 'Auto save', 500, 1, 3)
    testDb
      .prepare('INSERT INTO income_sources (id, name, amount, frequency, is_recurring, account_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(30, 'Salary', 1000, 'monthly', 1, 3)

    start({ enabled: true, intervalHours: 24 })

    expect(schedulerMocks.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Auto save', account_id: 1, notes: 'savings_source:20' })
    )
    expect(schedulerMocks.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Salary', account_id: 1, notes: 'income_source:30' })
    )
  })
})
