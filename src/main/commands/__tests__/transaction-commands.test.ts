import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, any>

class FakeDb {
  accounts: Row[] = []
  transactions: Row[] = []
  events: Row[] = []
  nextAccountId = 1
  nextTransactionId = 1
  nextEventId = 1

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

    if (sql.includes('INSERT INTO transactions') && sql.includes('VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')) {
      const row = {
        id: this.nextTransactionId++,
        description: args[0],
        amount: args[1],
        type: args[2],
        account_id: args[3],
        category_id: args[4],
        date: args[5],
        is_recurring: args[6],
        is_unnecessary: args[7],
        member_id: args[8],
        notes: args[9],
        hmac: args[10]
      }
      this.transactions.push(row)
      return { lastInsertRowid: row.id }
    }

    if (sql.includes('INSERT INTO transactions') && sql.includes('VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')) {
      const row = {
        id: args[0],
        description: args[1],
        amount: args[2],
        type: args[3],
        account_id: args[4],
        category_id: args[5],
        date: args[6],
        is_recurring: args[7],
        is_unnecessary: args[8],
        member_id: args[9],
        notes: args[10],
        hmac: args[11]
      }
      this.transactions.push(row)
      this.nextTransactionId = Math.max(this.nextTransactionId, row.id + 1)
      return { lastInsertRowid: row.id }
    }

    if (sql.includes('INSERT INTO transaction_events')) {
      const row = {
        event_id: this.nextEventId++,
        transaction_id: args[0],
        event_type: args[1],
        payload_json: args[2],
        actor: args[3],
        hmac: args[4],
        created_at: '2026-01-01 00:00:00'
      }
      this.events.push(row)
      return { lastInsertRowid: row.event_id }
    }

    if (sql.startsWith('DELETE FROM transactions')) {
      this.transactions = this.transactions.filter((row) => row.id !== args[0])
      return { changes: 1 }
    }

    if (sql.startsWith('UPDATE transactions SET')) {
      const id = args[args.length - 1]
      const row = this.transactions.find((tx) => tx.id === id)
      if (!row) return { changes: 0 }
      if (sql.includes('account_id = ?')) row.account_id = args[0]
      if (sql.includes('description = ?, amount = ?, type = ?, account_id = ?')) {
        Object.assign(row, {
          description: args[0],
          amount: args[1],
          type: args[2],
          account_id: args[3],
          category_id: args[4],
          date: args[5],
          is_recurring: args[6],
          is_unnecessary: args[7],
          member_id: args[8],
          notes: args[9],
          hmac: args[10]
        })
      } else {
        row.hmac = args[args.length - 2]
      }
      return { changes: 1 }
    }

    throw new Error(`Unhandled run SQL: ${sql}`)
  }

  private get(sql: string, args: any[]): any {
    if (sql.includes('SELECT id FROM accounts WHERE is_archived = 0')) {
      return this.accounts.find((row) => row.is_archived === 0)
    }
    if (sql.includes('SELECT * FROM transactions WHERE id = ?')) {
      return this.transactions.find((row) => row.id === args[0])
    }
    if (sql.includes('SELECT id FROM transactions WHERE id = ?')) {
      const found = this.transactions.find((row) => row.id === args[0])
      return found ? { id: found.id } : undefined
    }
    if (sql.includes('SELECT account_id FROM transactions WHERE id = ?')) {
      const found = this.transactions.find((row) => row.id === args[0])
      return found ? { account_id: found.account_id } : undefined
    }
    if (sql.includes('SELECT * FROM transactions WHERE id = ?')) {
      return this.transactions.find((row) => row.id === args[0])
    }
    if (sql.includes('SELECT id, account_id FROM transactions WHERE description = ?')) {
      const found = this.transactions.find((row) => row.description === args[0])
      return found ? { id: found.id, account_id: found.account_id } : undefined
    }
    if (sql.includes('SELECT id, name FROM accounts')) {
      const found = this.accounts[0]
      return found ? { id: found.id, name: found.name } : undefined
    }
    if (sql.includes("SELECT payload_json FROM transaction_events") && sql.includes("event_type = 'RESTORED'")) {
      return this.events.find((row) => row.transaction_id === args[0] && row.event_type === 'RESTORED')
    }
    if (sql.includes("SELECT payload_json FROM transaction_events") && sql.includes("event_type = 'UPDATED'")) {
      return this.events.find((row) => row.transaction_id === args[0] && row.event_type === 'UPDATED')
    }
    if (sql.includes('SELECT payload_json FROM transaction_events WHERE transaction_id = ?')) {
      return this.events.find((row) => row.transaction_id === args[0])
    }
    throw new Error(`Unhandled get SQL: ${sql}`)
  }

  private all(sql: string, args: any[]): any[] {
    if (sql.includes('FROM transactions') && sql.includes('lower(trim(description))')) {
      const [description, amount, type, accountId, date] = args
      return this.transactions.filter((row) =>
        String(row.description).trim().toLowerCase() === String(description).trim().toLowerCase() &&
        Math.round(Number(row.amount) * 100) / 100 === Math.round(Number(amount) * 100) / 100 &&
        row.type === type &&
        row.account_id === accountId &&
        row.date === date
      )
    }
    if (sql.includes('FROM transaction_events') && sql.includes('WHERE transaction_id = ?')) {
      return this.events.filter((row) => row.transaction_id === args[0]).sort((a, b) => a.event_id - b.event_id)
    }
    throw new Error(`Unhandled all SQL: ${sql}`)
  }
}

const dbRef = vi.hoisted((): { current: FakeDb | null } => ({ current: null }))

vi.mock('../../database-encrypted', () => ({
  getDatabase: () => dbRef.current
}))

vi.mock('../../crypto/integrity', () => ({
  signTransaction: vi.fn(() => 'tx-hmac'),
  signEventStoreEntry: vi.fn(() => 'event-hmac')
}))

describe('transaction command account and undo behavior', () => {
  beforeEach(() => {
    dbRef.current = new FakeDb()
  })

  afterEach(() => {
    dbRef.current = null
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('assigns the first active account when no account is supplied', async () => {
    const { createTransaction } = await import('../transaction-commands')
    const testDb = dbRef.current!
    testDb.prepare("INSERT INTO accounts (name, type, currency, is_archived) VALUES ('Main', 'checking', 'SEK', 0)").run()

    const result = createTransaction({
      description: 'Groceries',
      amount: 250,
      type: 'expense',
      date: '2026-01-02'
    })

    const row = testDb.prepare('SELECT account_id FROM transactions WHERE id = ?').get(result.id) as { account_id: number }
    const event = testDb.prepare('SELECT payload_json FROM transaction_events WHERE transaction_id = ?').get(result.id) as { payload_json: string }

    expect(row.account_id).toBe(1)
    expect(JSON.parse(event.payload_json)).toMatchObject({ account_id: 1, description: 'Groceries' })
  })

  it('creates Main account if a transaction is created before accounts exist', async () => {
    const { createTransaction } = await import('../transaction-commands')
    const testDb = dbRef.current!

    const result = createTransaction({
      description: 'Cash lunch',
      amount: 95,
      type: 'expense',
      date: '2026-01-02'
    })

    const account = testDb.prepare('SELECT id, name FROM accounts').get() as { id: number; name: string }
    const row = testDb.prepare('SELECT account_id FROM transactions WHERE id = ?').get(result.id) as { account_id: number }

    expect(account).toEqual({ id: 1, name: 'Main' })
    expect(row.account_id).toBe(1)
  })

  it('preserves an explicitly supplied account through import and undo restore', async () => {
    const { deleteTransaction, importTransactionsFromCsvWithEvents, undoLastChange } = await import('../transaction-commands')
    const testDb = dbRef.current!
    testDb.prepare("INSERT INTO accounts (name, type, currency, is_archived) VALUES ('Main', 'checking', 'SEK', 0)").run()
    testDb.prepare("INSERT INTO accounts (name, type, currency, is_archived) VALUES ('Revolut', 'checking', 'SEK', 0)").run()

    const importResult = importTransactionsFromCsvWithEvents(
      [{ description: 'Imported shop', amount: 100, date: '2026-01-03', type: 'expense' }],
      2
    )
    const row = testDb.prepare('SELECT id, account_id FROM transactions WHERE description = ?').get('Imported shop') as {
      id: number
      account_id: number
    }

    expect(importResult.imported).toBe(1)
    expect(row.account_id).toBe(2)

    expect(deleteTransaction(row.id)).toBe(true)
    expect(testDb.prepare('SELECT id FROM transactions WHERE id = ?').get(row.id)).toBeUndefined()

    expect(undoLastChange(row.id)).toBe(true)
    const restored = testDb.prepare('SELECT account_id FROM transactions WHERE id = ?').get(row.id) as { account_id: number }
    const restoredEvent = testDb
      .prepare("SELECT payload_json FROM transaction_events WHERE transaction_id = ? AND event_type = 'RESTORED'")
      .get(row.id) as { payload_json: string }

    expect(restored.account_id).toBe(2)
    expect(JSON.parse(restoredEvent.payload_json)).toMatchObject({ account_id: 2 })
  })

  it('skips duplicate imported transactions for the same account', async () => {
    const { importTransactionsFromCsvWithEvents } = await import('../transaction-commands')
    const testDb = dbRef.current!
    testDb.prepare("INSERT INTO accounts (name, type, currency, is_archived) VALUES ('Main', 'checking', 'SEK', 0)").run()

    const first = importTransactionsFromCsvWithEvents(
      [{ description: 'Imported shop', amount: 100, date: '2026-01-03', type: 'expense' }],
      1
    )
    const second = importTransactionsFromCsvWithEvents(
      [{ description: ' imported shop ', amount: 100, date: '2026-01-03', type: 'expense' }],
      1
    )

    expect(first).toEqual({ imported: 1, skippedDuplicates: 0 })
    expect(second).toEqual({ imported: 0, skippedDuplicates: 1 })
    expect(testDb.transactions).toHaveLength(1)
  })

  it('updates account_id and records the previous account in the event payload', async () => {
    const { createTransaction, updateTransaction } = await import('../transaction-commands')
    const testDb = dbRef.current!
    testDb.prepare("INSERT INTO accounts (name, type, currency, is_archived) VALUES ('Main', 'checking', 'SEK', 0)").run()
    testDb.prepare("INSERT INTO accounts (name, type, currency, is_archived) VALUES ('Cash', 'cash', 'SEK', 0)").run()
    const { id } = createTransaction({
      description: 'Taxi',
      amount: 180,
      type: 'expense',
      account_id: 1,
      date: '2026-01-04'
    })

    expect(updateTransaction({ id, account_id: 2 })).toBe(true)

    const row = testDb.prepare('SELECT account_id FROM transactions WHERE id = ?').get(id) as { account_id: number }
    const event = testDb
      .prepare("SELECT payload_json FROM transaction_events WHERE transaction_id = ? AND event_type = 'UPDATED'")
      .get(id) as { payload_json: string }

    expect(row.account_id).toBe(2)
    expect(JSON.parse(event.payload_json)).toMatchObject({
      account_id: 2,
      previous_values: { account_id: 1 }
    })
  })
})
