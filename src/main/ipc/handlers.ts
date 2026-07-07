import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { copyFileSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getDatabase, getDbPath, isDatabaseInitialized } from '../database-encrypted'
import { fetchExchangeRates, getCachedRates } from '../services/currency'
import { saveApiKey, getApiKey, deleteApiKey, hasApiKey } from '../services/keychain'
import {
  chatWithAI,
  suggestCategory,
  generateInsight,
  generateWeeklyTip,
  detectAnomalies
} from '../services/ai'
import { checkBudgetAlerts } from '../services/budget-alerts'
import { getSchedulerConfig, setSchedulerConfig } from '../services/scheduler'
import {
  importTransactionsFromCsv,
  parseCsvPreview,
  guessColumnIndexes,
  type CsvMapping
} from '../services/csv-import'
import { parseOfx } from '../services/ofx-import'
import {
  signBudgetEntry,
  signGoal,
  signCategory
} from '../crypto/integrity'
// CQRS imports
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
  recategorizeTransaction,
  flagTransaction,
  bulkRecategorizeTransactions,
  bulkDeleteTransactions,
  bulkFlagTransactions,
  undoLastChange,
  importTransactionsFromCsvWithEvents,
  rebuildTransactionsProjection
} from '../commands/transaction-commands'
import {
  getTransactions,
  getTransactionHistory,
  verifyTransactionIntegrity
} from '../queries/transaction-queries'

type GetWindow = () => BrowserWindow | null
type TransactionFilters = Record<string, unknown>
type ForecastTier = 'success' | 'warning' | 'destructive'

function parseDateToLocalYearMonth(dateStr: string): { year: number; month: number } {
  const parts = dateStr.split('-')
  return { year: parseInt(parts[0], 10), month: parseInt(parts[1], 10) }
}

function addMonths(dateStr: string, months: number): string {
  const parts = dateStr.split('-')
  const y = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  const d = parseInt(parts[2], 10)
  const totalMonths = y * 12 + (m - 1) + months
  const newYear = Math.floor(totalMonths / 12)
  const newMonth = (totalMonths % 12) + 1
  const lastDay = new Date(newYear, newMonth, 0).getDate()
  const newDay = Math.min(d, lastDay)
  return `${newYear}-${String(newMonth).padStart(2, '0')}-${String(newDay).padStart(2, '0')}`
}

function getNow(): Date {
  const now = new Date()
  return now
}

function roundCurrency(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

function monthlyAmount(amount: number, frequency?: string): number {
  if (frequency === 'weekly') return roundCurrency((amount * 52) / 12)
  if (frequency === 'fortnightly') return roundCurrency((amount * 26) / 12)
  if (frequency === 'yearly' || frequency === 'annual') return roundCurrency(amount / 12)
  return roundCurrency(amount)
}

function netFromGross(amount: number, taxPercent: number): number {
  const safeTax = Math.min(100, Math.max(0, Number.isFinite(taxPercent) ? taxPercent : 0))
  return roundCurrency(amount * (1 - safeTax / 100))
}

function budgetHealthTier(score: number, negative = false): ForecastTier {
  if (negative) return 'destructive'
  if (score >= 70) return 'success'
  if (score >= 40) return 'warning'
  return 'destructive'
}

function monthStart(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`
}

function addYearMonth(year: number, month: number, offset: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + offset
  return { year: Math.floor(total / 12), month: (total % 12) + 1 }
}

function normalizeMerchantName(description: string): string {
  return description.toLowerCase().trim().replace(/\s+/g, ' ')
}

function normalizePositiveInteger(value: unknown, fallback: number, max?: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const normalized = Math.max(1, Math.floor(parsed))
  return max ? Math.min(normalized, max) : normalized
}

function normalizeOffset(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.floor(parsed))
}

function buildTransactionWhere(filters?: TransactionFilters): { sql: string; params: unknown[] } {
  let sql = ' WHERE 1=1'
  const params: unknown[] = []

  const year = Number(filters?.year)
  const month = Number(filters?.month)
  if (Number.isInteger(year) && year > 0 && Number.isInteger(month) && month >= 1 && month <= 12) {
    const start = `${year}-${String(month).padStart(2, '0')}-01`
    const nextYear = month === 12 ? year + 1 : year
    const nextMonth = month === 12 ? 1 : month + 1
    const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`
    sql += ' AND t.date >= ? AND t.date < ?'
    params.push(start, end)
  } else if (Number.isInteger(year) && year > 0) {
    sql += ' AND t.date >= ? AND t.date < ?'
    params.push(`${year}-01-01`, `${year + 1}-01-01`)
  }

  if (filters?.categoryId) {
    sql += ' AND t.category_id = ?'
    params.push(filters.categoryId)
  }
  if (filters?.type) {
    sql += ' AND t.type = ?'
    params.push(filters.type)
  }
  if (filters?.accountId) {
    sql += ' AND t.account_id = ?'
    params.push(filters.accountId)
  }
  if (filters?.flagged) {
    sql += ' AND t.is_unnecessary = 1'
  }
  if (filters?.search) {
    sql += ' AND t.description LIKE ? COLLATE NOCASE'
    params.push(`%${filters.search}%`)
  }
  if (filters?.recurring === true) {
    sql += ' AND t.is_recurring = 1'
  }
  if (filters?.recurring === false) {
    sql += ' AND t.is_recurring = 0'
  }

  return { sql, params }
}

function getTransactionOrderBy(sort: unknown): string {
  if (sort === 'amount-desc') return ' ORDER BY t.amount DESC, t.date DESC, t.id DESC'
  if (sort === 'amount-asc') return ' ORDER BY t.amount ASC, t.date DESC, t.id DESC'
  if (sort === 'category') return ' ORDER BY c.name COLLATE NOCASE ASC, t.date DESC, t.id DESC'
  if (sort === 'date-asc') return ' ORDER BY t.date ASC, t.id ASC'
  return ' ORDER BY t.date DESC, t.id DESC'
}

function getPrimaryAccountId(database = getDatabase()): number {
  const existing = database
    .prepare("SELECT id FROM accounts WHERE is_archived = 0 ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined
  if (existing) return existing.id

  const result = database
    .prepare("INSERT INTO accounts (name, type, currency, is_archived) VALUES ('Main', 'checking', 'SEK', 0)")
    .run()
  return Number(result.lastInsertRowid)
}

function normalizeAccountId(accountId: unknown, database = getDatabase()): number {
  const parsed = typeof accountId === 'number' ? accountId : typeof accountId === 'string' ? parseInt(accountId, 10) : NaN
  if (Number.isFinite(parsed)) {
    const account = database
      .prepare('SELECT id FROM accounts WHERE id = ? AND is_archived = 0')
      .get(parsed) as { id: number } | undefined
    if (account) return account.id
  }
  return getPrimaryAccountId(database)
}

export function registerIpcHandlers(getWindow: GetWindow): void {
  const db = () => getDatabase()

  // Wrap ipcMain.handle with a guard that catches "not initialized" errors for DB handlers
  const originalHandle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = ((channel: string, listener: any) => {
    originalHandle(channel, async (event: any, ...args: any[]) => {
      try {
        return await listener(event, ...args)
      } catch (err: any) {
        if (err?.message?.includes('Database not initialized')) {
          console.warn(`Handler "${channel}" skipped — database not initialized`)
          return null
        }
        throw err
      }
    }) as any
  }) as any

  // Settings & profile
  ipcMain.handle('settings:get', (_, key: string) => {
    const row = db().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    if (!row) return null
    try {
      return JSON.parse(row.value)
    } catch {
      return null
    }
  })

  ipcMain.handle('settings:set', (_, key: string, value: unknown) => {
    db()
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(key, JSON.stringify(value))
    return true
  })

  ipcMain.handle('settings:getProfile', () => {
    const row = db().prepare("SELECT value FROM settings WHERE key = 'profile'").get() as
      | { value: string }
      | undefined
    if (!row) return {}
    try {
      return JSON.parse(row.value)
    } catch {
      return {}
    }
  })

  ipcMain.handle('settings:setProfile', (_, profile: Record<string, unknown>) => {
    db()
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('profile', ?)")
      .run(JSON.stringify(profile))
    return profile
  })

  // Accounts
  ipcMain.handle('accounts:list', () => {
    return db()
      .prepare(
        `SELECT a.*,
         COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END), 0) as balance,
         COUNT(t.id) as transaction_count
         FROM accounts a
         LEFT JOIN transactions t ON t.account_id = a.id
         GROUP BY a.id
         ORDER BY a.is_archived ASC, a.id ASC`
      )
      .all()
  })

  ipcMain.handle('accounts:create', (_, account) => {
    const name = String(account.name ?? '').trim()
    if (!name) throw new Error('Account name is required')
    const type = ['checking', 'savings', 'cash', 'other'].includes(account.type) ? account.type : 'checking'
    const currency = ['SEK', 'EUR', 'USD'].includes(account.currency) ? account.currency : 'SEK'
    const result = db()
      .prepare('INSERT INTO accounts (name, type, currency, is_archived) VALUES (?, ?, ?, 0)')
      .run(name, type, currency)
    return { id: Number(result.lastInsertRowid) }
  })

  ipcMain.handle('accounts:update', (_, id: number, account) => {
    const name = String(account.name ?? '').trim()
    if (!name) throw new Error('Account name is required')
    const type = ['checking', 'savings', 'cash', 'other'].includes(account.type) ? account.type : 'checking'
    const currency = ['SEK', 'EUR', 'USD'].includes(account.currency) ? account.currency : 'SEK'
    db()
      .prepare('UPDATE accounts SET name = ?, type = ?, currency = ? WHERE id = ?')
      .run(name, type, currency, id)
    return true
  })

  ipcMain.handle('accounts:archive', (_, id: number) => {
    const database = db()
    const activeCount = database.prepare('SELECT COUNT(*) as count FROM accounts WHERE is_archived = 0').get() as { count: number }
    if (activeCount.count <= 1) throw new Error('At least one active account is required')
    database.prepare('UPDATE accounts SET is_archived = 1 WHERE id = ?').run(id)
    return true
  })

  ipcMain.handle('scheduler:getConfig', () => getSchedulerConfig())

  ipcMain.handle('scheduler:setConfig', (_, config) => {
    setSchedulerConfig(config)
    return true
  })

  ipcMain.handle('rules:list', () => {
    return db()
      .prepare('SELECT r.*, c.name as category_name FROM categorization_rules r LEFT JOIN categories c ON r.category_id = c.id ORDER BY r.id')
      .all()
  })

  ipcMain.handle('rules:create', (_, rule: { pattern: string; categoryId: number }) => {
    const r = db()
      .prepare('INSERT INTO categorization_rules (pattern, category_id) VALUES (?, ?)')
      .run(rule.pattern, rule.categoryId)
    return { id: Number(r.lastInsertRowid) }
  })

  ipcMain.handle('rules:delete', (_, id: number) => {
    db().prepare('DELETE FROM categorization_rules WHERE id = ?').run(id)
    return true
  })

  ipcMain.handle('rules:apply', () => {
    const rules = db().prepare('SELECT * FROM categorization_rules').all() as { pattern: string; category_id: number }[]
    const txs = db().prepare(
      "SELECT id, description FROM transactions WHERE category_id IS NULL"
    ).all() as { id: number; description: string }[]
    const updated: number[] = []
    for (const tx of txs) {
      for (const rule of rules) {
        if (tx.description.includes(rule.pattern)) {
          db().prepare('UPDATE transactions SET category_id = ? WHERE id = ?').run(rule.category_id, tx.id)
          updated.push(tx.id)
          break
        }
      }
    }
    return updated
  })

  // Years
  ipcMain.handle('years:list', () => {
    const transactionYears = db()
      .prepare("SELECT DISTINCT CAST(strftime('%Y', date) AS INTEGER) as year FROM transactions ORDER BY year DESC")
      .all() as Array<{ year: number }>
    const budgetYears = db()
      .prepare('SELECT DISTINCT year FROM budget_entries ORDER BY year DESC')
      .all() as Array<{ year: number }>
    const incomeYears = db()
      .prepare('SELECT DISTINCT year FROM income_entries ORDER BY year DESC')
      .all() as Array<{ year: number }>
    const moodYears = db()
      .prepare('SELECT DISTINCT year FROM monthly_mood ORDER BY year DESC')
      .all() as Array<{ year: number }>

    const yearSet = new Set<number>()
    for (const y of [...transactionYears, ...budgetYears, ...incomeYears, ...moodYears]) {
      yearSet.add(y.year)
    }

    const currentYear = new Date().getFullYear()
    // Always include the previous year and current year
    yearSet.add(currentYear)
    yearSet.add(currentYear - 1)

    return Array.from(yearSet).sort((a, b) => b - a)
  })

  // Currency
  ipcMain.handle('currency:fetch', () => fetchExchangeRates())
  ipcMain.handle('currency:cached', () => getCachedRates())

  // API key
  ipcMain.handle('ai:saveKey', (_, key: string) => saveApiKey(key))
  ipcMain.handle('ai:hasKey', () => hasApiKey())
  ipcMain.handle('ai:deleteKey', () => deleteApiKey())
  ipcMain.handle('ai:chat', (_, messages, ctx) => chatWithAI(messages, ctx))
  ipcMain.handle('ai:suggestCategory', (_, desc) => suggestCategory(desc))
  ipcMain.handle('ai:insight', () => generateInsight())
  ipcMain.handle('ai:weeklyTip', () => generateWeeklyTip())
  ipcMain.handle('ai:detectAnomalies', () => detectAnomalies())

  // Household
  ipcMain.handle('members:list', () => db().prepare('SELECT * FROM household_members').all())
  ipcMain.handle('members:create', (_, data: { name: string; color?: string }) => {
    const r = db()
      .prepare('INSERT INTO household_members (name, color) VALUES (?, ?)')
      .run(data.name, data.color ?? '#6366f1')
    return { id: Number(r.lastInsertRowid), ...data }
  })
  ipcMain.handle('members:delete', (_, id: number) => {
    db().prepare('DELETE FROM household_members WHERE id = ?').run(id)
    return true
  })

  // Categories
  ipcMain.handle('categories:list', () =>
    db().prepare('SELECT * FROM categories ORDER BY sort_order, name').all()
  )
  ipcMain.handle('categories:create', (_, cat) => {
    // Compute HMAC signature
    const hmac = signCategory({
      name: cat.name,
      budget_amount: cat.budgetAmount ?? 0,
      is_fixed: cat.isFixed ? 1 : 0
    })
    
    const r = db()
      .prepare(
        'INSERT INTO categories (name, icon, color, is_fixed, budget_amount, sort_order, hmac) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        cat.name,
        cat.icon ?? 'wallet',
        cat.color ?? '#6366f1',
        cat.isFixed ? 1 : 0,
        cat.budgetAmount ?? 0,
        cat.sortOrder ?? 0,
        hmac
      )
    return { id: Number(r.lastInsertRowid), ...cat }
  })
  ipcMain.handle('categories:update', (_, id: number, cat) => {
    // Compute new HMAC signature
    const hmac = signCategory({
      name: cat.name,
      budget_amount: cat.budgetAmount,
      is_fixed: cat.isFixed ? 1 : 0
    })
    
    db()
      .prepare(
        'UPDATE categories SET name=?, icon=?, color=?, is_fixed=?, budget_amount=?, sort_order=?, hmac=? WHERE id=?'
      )
      .run(
        cat.name,
        cat.icon,
        cat.color,
        cat.isFixed ? 1 : 0,
        cat.budgetAmount,
        cat.sortOrder,
        hmac,
        id
      )
    return true
  })
  ipcMain.handle('categories:delete', (_, id: number) => {
    db().prepare('DELETE FROM categories WHERE id = ?').run(id)
    return true
  })

  // Budget entries
  ipcMain.handle('budget:getMonth', (_, year: number, month: number) => {
    return db()
      .prepare(
        `SELECT c.id as category_id, c.name, c.icon, c.color, c.is_fixed,
         COALESCE(be.amount, c.budget_amount, 0) as amount, be.notes, be.id as entry_id
         FROM categories c
         LEFT JOIN budget_entries be ON be.category_id = c.id AND be.year = ? AND be.month = ?
         ORDER BY c.sort_order, c.name`
      )
      .all(year, month)
  })
  ipcMain.handle('budget:categoryDetail', (_, categoryId: number, year: number, month: number) => {
    const ym = String(month).padStart(2, '0')
    const prevMonth = month === 1 ? 12 : month - 1
    const prevYear = month === 1 ? year - 1 : year
    const prevYm = String(prevMonth).padStart(2, '0')

    const history = db()
      .prepare(
        `SELECT CAST(strftime('%m', t.date) AS INTEGER) as month,
         COALESCE(SUM(CASE WHEN t.type='income' THEN -t.amount ELSE t.amount END), 0) as spent
         FROM transactions t
         WHERE t.category_id = ? AND t.type IN ('expense','income','transfer') AND strftime('%Y', t.date) = ?
         GROUP BY month ORDER BY month`
      )
      .all(categoryId, String(year)) as { month: number; spent: number }[]

    const currentSpent = db()
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN type='income' THEN -amount ELSE amount END), 0) as v FROM transactions
         WHERE category_id = ? AND type IN ('expense','income','transfer') AND strftime('%Y', date) = ? AND strftime('%m', date) = ?`
      )
      .get(categoryId, String(year), ym) as { v: number }

    const prevSpent = db()
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN type='income' THEN -amount ELSE amount END), 0) as v FROM transactions
         WHERE category_id = ? AND type IN ('expense','income','transfer') AND strftime('%Y', date) = ? AND strftime('%m', date) = ?`
      )
      .get(categoryId, String(prevYear), prevYm) as { v: number }

    const momChange =
      prevSpent.v > 0 ? ((currentSpent.v - prevSpent.v) / prevSpent.v) * 100 : currentSpent.v > 0 ? 100 : 0

    const ytdAvg = db()
      .prepare(
        `SELECT COALESCE(AVG(monthly), 0) as avg FROM (
           SELECT SUM(CASE WHEN type='income' THEN -amount ELSE amount END) as monthly FROM transactions
           WHERE category_id = ? AND type IN ('expense','income','transfer') AND strftime('%Y', date) = ?
           GROUP BY strftime('%m', date)
         )`
      )
      .get(categoryId, String(year)) as { avg: number }

    const prevYearSpent = db()
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN type='income' THEN -amount ELSE amount END), 0) as v FROM transactions
         WHERE category_id = ? AND type IN ('expense','income','transfer') AND strftime('%Y', date) = ?`
      )
      .get(categoryId, String(year - 1)) as { v: number }

    const transactions = db()
      .prepare(
        `SELECT t.*, c.name as category_name FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.category_id = ? AND strftime('%Y', t.date) = ? AND strftime('%m', t.date) = ?
         ORDER BY t.date DESC`
      )
      .all(categoryId, String(year), ym)

    const notes = db()
      .prepare('SELECT notes FROM budget_entries WHERE category_id = ? AND year = ? AND month = ?')
      .get(categoryId, year, month) as { notes: string | null } | undefined

    const category = db().prepare('SELECT * FROM categories WHERE id = ?').get(categoryId)

    return {
      category,
      history,
      momChange,
      ytdAverage: ytdAvg.avg,
      prevYearTotal: prevYearSpent.v,
      transactions,
      notes: notes?.notes ?? ''
    }
  })
  ipcMain.handle('budget:setEntry', (_, data) => {
    const database = db()
    const tx = database.transaction((txData) => {
      // Compute HMAC signature
      const hmac = signBudgetEntry({
        category_id: txData.categoryId,
        year: txData.year,
        month: txData.month,
        amount: txData.amount
      })
      
      database.prepare(
        `INSERT INTO budget_entries (category_id, year, month, amount, notes, hmac)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(category_id, year, month) DO UPDATE SET amount=excluded.amount, notes=excluded.notes, hmac=excluded.hmac`
      ).run(txData.categoryId, txData.year, txData.month, txData.amount, txData.notes ?? null, hmac)

      // Propagate to future months — always update future, never touch past
      const now = getNow()
      const currentMonthNum = now.getFullYear() * 12 + (now.getMonth() + 1)
      const inputMonthNum = txData.year * 12 + txData.month

      if (inputMonthNum >= currentMonthNum) {
        for (let offset = 1; offset <= 24 - txData.month; offset++) {
          const targetMonth = txData.month + offset
          const targetYear = txData.year + Math.floor((targetMonth - 1) / 12)
          const m = ((targetMonth - 1) % 12) + 1
          if (m < txData.month && targetYear <= txData.year) continue
          const futureHmac = signBudgetEntry({
            category_id: txData.categoryId,
            year: targetYear,
            month: m,
            amount: txData.amount
          })
          database.prepare(
            `INSERT INTO budget_entries (category_id, year, month, amount, notes, hmac)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(category_id, year, month) DO UPDATE SET amount=excluded.amount, notes=excluded.notes, hmac=excluded.hmac`
          ).run(txData.categoryId, targetYear, m, txData.amount, txData.notes ?? null, futureHmac)
        }
      }
      return true
    })
    return tx(data)
  })

  // Transactions
  ipcMain.handle('transactions:list', (_, filters?: Record<string, unknown>) => {
    let sql = `SELECT t.*, c.name as category_name, c.icon as category_icon, c.color as category_color,
               m.name as member_name, a.name as account_name, a.type as account_type, a.currency as account_currency
               FROM transactions t
               LEFT JOIN categories c ON t.category_id = c.id
               LEFT JOIN household_members m ON t.member_id = m.id
               LEFT JOIN accounts a ON t.account_id = a.id`
    const { sql: whereSql, params } = buildTransactionWhere(filters)
    sql += whereSql
    sql += getTransactionOrderBy(filters?.sort)

    if (filters?.paginate === true || filters?.limit !== undefined) {
      sql += ' LIMIT ? OFFSET ?'
      params.push(normalizePositiveInteger(filters?.limit, 100, 500), normalizeOffset(filters?.offset))
    }

    return db().prepare(sql).all(...params)
  })

  ipcMain.handle('transactions:count', (_, filters?: Record<string, unknown>) => {
    const { sql: whereSql, params } = buildTransactionWhere(filters)
    const row = db()
      .prepare(`SELECT COUNT(*) as count FROM transactions t${whereSql}`)
      .get(...params) as { count: number }
    return row.count
  })

  // Use command pattern for transaction creation
  ipcMain.handle('transactions:create', (_, tx) => {
    if (!Number.isFinite(tx.amount) || tx.amount <= 0) {
      throw new Error('Amount must be a positive number')
    }
    if (!tx.description?.trim()) {
      throw new Error('Description is required')
    }
    // Auto-assign savings category for savings transactions
    let savingsCategoryId: number | null = null
    if (tx.type === 'savings') {
      savingsCategoryId = getSavingsCategoryId(db())
    }
    const assignedCategoryId = tx.type === 'savings' && !tx.categoryId ? savingsCategoryId : (tx.categoryId ?? null)
    const accountId = normalizeAccountId(tx.accountId)

    const result = createTransaction({
      description: tx.description,
      amount: tx.amount,
      type: tx.type,
      account_id: accountId,
      category_id: assignedCategoryId,
      date: tx.date,
      is_recurring: tx.isRecurring ?? false,
      is_unnecessary: tx.isUnnecessary ?? false,
      member_id: tx.memberId ?? null,
      notes: tx.notes ?? null
    })
    
    // If recurring, auto-create subscription (non-savings) or savings source (savings)
    if (tx.isRecurring) {
      if (tx.type === 'savings') {
        const ssResult = db().prepare(
          `INSERT INTO savings_sources (description, amount, is_recurring, frequency, category_id, account_id, transaction_id)
           VALUES (?, ?, 1, 'monthly', ?, ?, ?)`
        ).run(tx.description, tx.amount, savingsCategoryId, accountId, result.id)
        const sourceId = Number(ssResult.lastInsertRowid)
        const marker = 'savings_source:' + sourceId
        const newNotes = tx.notes ? tx.notes + ' | ' + marker : marker
        db().prepare('UPDATE transactions SET notes = ? WHERE id = ?').run(newNotes, result.id)
      } else {
        // Start next billing one month from now — the current transaction is the first bill
        const nextDate = addMonths(tx.date, 1)
        db().prepare(
          `INSERT INTO subscriptions (name, amount, frequency, next_billing_date, account_id, transaction_id)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(tx.description, tx.amount, 'monthly', nextDate, accountId, result.id)
      }
    }
    
    updateSpendingStreak(tx.date)
    const { year: txYear, month: txMonth } = parseDateToLocalYearMonth(tx.date)
    if (tx.categoryId) {
      checkBudgetAlerts(tx.categoryId, txYear, txMonth)
    }
    return result
  })
  // Use command pattern for transaction updates
  ipcMain.handle('transactions:update', (_, id: number, tx) => {
    // Get current state before update
    const current = db().prepare('SELECT is_recurring, description, amount, date, type, account_id FROM transactions WHERE id = ?').get(id) as
      | { is_recurring: number; description: string; amount: number; date: string; type: string; account_id: number | null }
      | undefined

    if (!current) {
      throw new Error(`Transaction ${id} not found`)
    }

    const result = updateTransaction({
      id,
      description: tx.description,
      amount: tx.amount,
      type: tx.type,
      account_id: tx.accountId !== undefined ? normalizeAccountId(tx.accountId) : undefined,
      category_id: tx.categoryId !== undefined ? tx.categoryId : undefined,
      date: tx.date,
      is_recurring: tx.isRecurring ? true : tx.isRecurring === false ? false : undefined,
      is_unnecessary: tx.isUnnecessary,
      member_id: tx.memberId !== undefined ? tx.memberId : undefined,
      notes: tx.notes !== undefined ? tx.notes : undefined
    })

    const description = tx.description ?? current.description
    const amount = tx.amount ?? current.amount
    const date = tx.date ?? current.date
    const accountId = tx.accountId !== undefined ? normalizeAccountId(tx.accountId) : current.account_id

    if (tx.isRecurring !== undefined) {
      const wasRecurring = current.is_recurring === 1
      const isRecurring = tx.isRecurring
      const txType = tx.type ?? current.type

      if (wasRecurring && !isRecurring) {
        db().prepare('DELETE FROM subscriptions WHERE transaction_id = ?').run(id)
        db().prepare('DELETE FROM savings_sources WHERE transaction_id = ?').run(id)
      } else if (!wasRecurring && isRecurring) {
        if (txType === 'savings') {
          const savingsCategoryId = getSavingsCategoryId(db())
          const ssResult = db().prepare(
            `INSERT INTO savings_sources (description, amount, is_recurring, frequency, category_id, account_id, transaction_id)
             VALUES (?, ?, 1, 'monthly', ?, ?, ?)`
          ).run(description, amount, savingsCategoryId, accountId, id)
          const sourceId = Number(ssResult.lastInsertRowid)
          const marker = 'savings_source:' + sourceId
          const existingNotes = db().prepare('SELECT notes FROM transactions WHERE id = ?').get(id) as { notes: string | null } | undefined
          const currentNotes = existingNotes?.notes ?? ''
          const newNotes = currentNotes ? currentNotes + ' | ' + marker : marker
          db().prepare('UPDATE transactions SET notes = ? WHERE id = ?').run(newNotes, id)
        } else {
          const nextDate = addMonths(date, 1)
          db().prepare(
            `INSERT INTO subscriptions (name, amount, frequency, next_billing_date, account_id, transaction_id)
             VALUES (?, ?, 'monthly', ?, ?, ?)`
          ).run(description, amount, nextDate, accountId, id)
        }
      } else if (wasRecurring && isRecurring) {
        if (txType === 'savings') {
          db().prepare('DELETE FROM subscriptions WHERE transaction_id = ?').run(id)
          db().prepare(
            `UPDATE savings_sources SET description = ?, amount = ?, account_id = ? WHERE transaction_id = ?`
          ).run(description, amount, accountId, id)
        } else {
          db().prepare(
            `UPDATE subscriptions SET name = ?, amount = ?, account_id = ? WHERE transaction_id = ?`
          ).run(description, amount, accountId, id)
        }
      }
    }
    
    // Check budget alerts if category changed
    if (tx.categoryId) {
      const { year: dYear, month: dMonth } = parseDateToLocalYearMonth(date)
      checkBudgetAlerts(tx.categoryId, dYear, dMonth)
    }
    return result
  })
  // Use command pattern for transaction deletion
  ipcMain.handle('transactions:delete', (_, id: number) => {
    db().prepare('DELETE FROM savings_sources WHERE transaction_id = ?').run(id)
    db().prepare('DELETE FROM subscriptions WHERE transaction_id = ?').run(id)
    return deleteTransaction(id)
  })
  // Use command pattern for bulk operations
  ipcMain.handle('transactions:bulk', (_, action: string, ids: number[], data?: unknown) => {
    if (action === 'recategorize' && data) {
      const catId = (data as { categoryId: number }).categoryId
      return bulkRecategorizeTransactions(ids, catId)
    }
    if (action === 'delete') {
      const database = db()
      const tx = database.transaction((txIds: number[]) => {
        const delSub = database.prepare('DELETE FROM subscriptions WHERE transaction_id = ?')
        const delSavings = database.prepare('DELETE FROM savings_sources WHERE transaction_id = ?')
        for (const id of txIds) {
          delSub.run(id)
          delSavings.run(id)
        }
        return bulkDeleteTransactions(txIds)
      })
      return tx(ids)
    }
    if (action === 'flag') {
      return bulkFlagTransactions(ids)
    }
    return false
  })
  ipcMain.handle('transactions:csvPreview', (_, csv: string) => {
    const preview = parseCsvPreview(csv)
    const guessed = guessColumnIndexes(preview.headers)
    return { ...preview, guessed }
  })

  // CSV export
  ipcMain.handle('transactions:exportCsv', () => {
    const rows = db()
      .prepare(
        `SELECT t.description, t.amount, t.date, t.type, c.name as category_name, a.name as account_name
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         LEFT JOIN accounts a ON t.account_id = a.id
         ORDER BY t.date DESC, t.id DESC`
      )
      .all() as { description: string; amount: number; date: string; type: string; category_name?: string; account_name?: string }[]
    const { exportTransactionsToCsv } = require('../services/csv-import')
    return exportTransactionsToCsv(rows)
  })

  // Use command pattern for CSV import
  ipcMain.handle('transactions:importCsv', (_, csv: string, mapping?: CsvMapping & { accountId?: number }) => {
    const preview = parseCsvPreview(csv, 1)
    const map: CsvMapping = mapping ?? {
      ...guessColumnIndexes(preview.headers),
      delimiter: preview.delimiter,
      hasHeader: true
    }
    const rows = importTransactionsFromCsv(csv, map)
    return importTransactionsFromCsvWithEvents(rows, normalizeAccountId(mapping?.accountId))
  })

  ipcMain.handle('transactions:importOfx', async (_, accountId?: number) => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Import OFX/QFX file',
      filters: [{ name: 'OFX/QFX', extensions: ['ofx', 'qfx'] }],
      properties: ['openFile']
    })
    if (!result.canceled && result.filePaths[0]) {
      const content = readFileSync(result.filePaths[0], 'utf8')
      const rows = parseOfx(content)
      return importTransactionsFromCsvWithEvents(rows, normalizeAccountId(accountId))
    }
    return { imported: 0 }
  })

  // New transaction event sourcing handlers
  ipcMain.handle('transactions:history', (_, id: number) => {
    return getTransactionHistory(id)
  })
  
  ipcMain.handle('transactions:undo', (_, id: number) => {
    return undoLastChange(id)
  })

  // Goals
  ipcMain.handle('goals:list', () => {
    const goals = db().prepare('SELECT * FROM goals ORDER BY id').all() as Array<{
      id: number
      type: string
      name: string
      current_amount: number
      target_amount: number
    }>

    return goals.map((g) => ({ ...g, current_amount: getGoalCurrentAmount(db(), g.type) }))
  })

  ipcMain.handle('goals:autoCreateFromCategories', () => {
    const categories = db().prepare('SELECT * FROM categories WHERE goal_type IS NOT NULL').all() as Array<{
      id: number
      name: string
      goal_type: string
    }>

    const existingGoals = db().prepare('SELECT type FROM goals').all() as Array<{ type: string }>
    const existingTypes = new Set(existingGoals.map((g) => g.type))

    for (const cat of categories) {
      if (!existingTypes.has(cat.goal_type)) {
        let targetAmount = 0
        let notes = ''

        // Auto-calculate target based on goal type
        if (cat.goal_type === 'emergency') {
          const avg = db()
            .prepare(
              `SELECT COALESCE(AVG(monthly), 0) as avg FROM (
                 SELECT SUM(amount) as monthly FROM transactions
                 WHERE type = 'expense' AND date >= date('now', '-12 months')
                 GROUP BY strftime('%Y-%m', date)
               )`
            )
            .get() as { avg: number }
          targetAmount = Math.round(avg.avg * 3)
          notes = 'Auto-calculated: 3× average monthly expenses'
        } else if (cat.goal_type === 'fire') {
          const annualExpenses = db()
            .prepare(
              `SELECT COALESCE(SUM(amount), 0) as v FROM transactions
               WHERE type = 'expense' AND date >= date('now', '-12 months')`
            )
            .get() as { v: number }
          targetAmount = Math.round(annualExpenses.v * 25)
          notes = 'Auto-calculated: 25× annual expenses'
        } else if (cat.goal_type === 'investment') {
          targetAmount = 100000 // Default investment goal
          notes = 'Default target - adjust as needed'
        }

        db()
          .prepare(
            `INSERT INTO goals (name, type, target_amount, current_amount, notes)
             VALUES (?, ?, ?, 0, ?)`
          )
          .run(cat.name, cat.goal_type, targetAmount, notes)
      }
    }

    return true
  })
  ipcMain.handle('goals:create', (_, goal) => {
    const r = db()
      .prepare(
        `INSERT INTO goals (name, type, target_amount, current_amount, target_date, interest_rate, monthly_payment, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        goal.name,
        goal.type,
        goal.targetAmount,
        goal.currentAmount ?? 0,
        goal.targetDate,
        goal.interestRate,
        goal.monthlyPayment,
        goal.notes
      )
    return { id: Number(r.lastInsertRowid) }
  })
  ipcMain.handle('goals:update', (_, id: number, goal) => {
    db()
      .prepare(
        `UPDATE goals SET name=?, type=?, target_amount=?, current_amount=?, target_date=?,
         interest_rate=?, monthly_payment=?, notes=? WHERE id=?`
      )
      .run(
        goal.name,
        goal.type,
        goal.targetAmount,
        goal.currentAmount,
        goal.targetDate,
        goal.interestRate,
        goal.monthlyPayment,
        goal.notes,
        id
      )
    return true
  })
  ipcMain.handle('goals:delete', (_, id: number) => {
    db().prepare('DELETE FROM goals WHERE id = ?').run(id)
    return true
  })

  // Wealth
  ipcMain.handle('wealth:list', () =>
    db().prepare('SELECT * FROM wealth_snapshots ORDER BY date').all()
  )
  ipcMain.handle('wealth:create', (_, snap) => {
    const r = db()
      .prepare(
        `INSERT INTO wealth_snapshots (date, assets_savings, assets_investments, assets_property,
         liabilities_loans, liabilities_credit, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        snap.date,
        snap.assetsSavings,
        snap.assetsInvestments,
        snap.assetsProperty,
        snap.liabilitiesLoans,
        snap.liabilitiesCredit,
        snap.notes
      )
    return { id: Number(r.lastInsertRowid) }
  })

  ipcMain.handle('investments:list', () => db().prepare('SELECT * FROM investments').all())
  ipcMain.handle('investments:create', (_, inv) => {
    const r = db()
      .prepare(
        'INSERT INTO investments (name, purchase_price, current_value, purchase_date, notes) VALUES (?, ?, ?, ?, ?)'
      )
      .run(inv.name, inv.purchasePrice, inv.currentValue, inv.purchaseDate, inv.notes)
    return { id: Number(r.lastInsertRowid) }
  })
  ipcMain.handle('investments:update', (_, id: number, inv) => {
    db()
      .prepare(
        'UPDATE investments SET name=?, purchase_price=?, current_value=?, purchase_date=?, notes=? WHERE id=?'
      )
      .run(inv.name, inv.purchasePrice, inv.currentValue, inv.purchaseDate, inv.notes, id)
    return true
  })
  ipcMain.handle('investments:delete', (_, id: number) => {
    db().prepare('DELETE FROM investments WHERE id = ?').run(id)
    return true
  })

  // Investment Holdings (for tracking specific ETFs)
  ipcMain.handle('investmentHoldings:list', () => db().prepare('SELECT * FROM investment_holdings ORDER BY id').all())
  ipcMain.handle('investmentHoldings:create', (_, holding) => {
    const r = db()
      .prepare(
        'INSERT INTO investment_holdings (etf_name, ticker, shares, avg_cost, current_price, current_value, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(holding.etfName, holding.ticker, holding.shares, holding.avgCost, holding.currentPrice, holding.currentValue, holding.notes)
    return { id: Number(r.lastInsertRowid) }
  })
  ipcMain.handle('investmentHoldings:update', (_, id: number, holding) => {
    db()
      .prepare(
        'UPDATE investment_holdings SET etf_name=?, ticker=?, shares=?, avg_cost=?, current_price=?, current_value=?, notes=? WHERE id=?'
      )
      .run(holding.etfName, holding.ticker, holding.shares, holding.avgCost, holding.currentPrice, holding.currentValue, holding.notes, id)
    return true
  })
  ipcMain.handle('investmentHoldings:delete', (_, id: number) => {
    db().prepare('DELETE FROM investment_holdings WHERE id = ?').run(id)
    return true
  })
  ipcMain.handle('investmentHoldings:totalValue', () => {
    const result = db().prepare('SELECT COALESCE(SUM(current_value), 0) as v FROM investment_holdings').get() as { v: number }
    return result.v
  })

  // Subscriptions
  ipcMain.handle('subscriptions:list', () =>
    db().prepare(
      `SELECT s.*, t.description as transaction_description, a.name as account_name
       FROM subscriptions s
       LEFT JOIN transactions t ON s.transaction_id = t.id
       LEFT JOIN accounts a ON s.account_id = a.id
       ORDER BY s.amount DESC`
    ).all()
  )
  ipcMain.handle('subscriptions:create', (_, sub) => {
    const accountId = normalizeAccountId(sub.accountId)
    const r = db()
      .prepare(
        `INSERT INTO subscriptions (name, amount, frequency, next_billing_date, website_url, icon, color, notes, tax_deductible, on_hold, account_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        sub.name,
        sub.amount,
        sub.frequency,
        sub.nextBillingDate,
        sub.websiteUrl,
        sub.icon,
        sub.color,
        sub.notes,
        sub.taxDeductible ? 1 : 0,
        sub.onHold ? 1 : 0,
        accountId
      )
    return { id: Number(r.lastInsertRowid) }
  })
  ipcMain.handle('subscriptions:update', (_, id: number, sub) => {
    const accountId = normalizeAccountId(sub.accountId)
    db()
      .prepare(
        `UPDATE subscriptions SET name=?, amount=?, frequency=?, next_billing_date=?,
         website_url=?, icon=?, color=?, notes=?, tax_deductible=?, on_hold=?, account_id=? WHERE id=?`
      )
      .run(
        sub.name,
        sub.amount,
        sub.frequency,
        sub.nextBillingDate,
        sub.websiteUrl,
        sub.icon,
        sub.color,
        sub.notes,
        sub.taxDeductible ? 1 : 0,
        sub.onHold ? 1 : 0,
        accountId,
        id
      )
    return true
  })
  ipcMain.handle('subscriptions:delete', (_, id: number) => {
    const sub = db().prepare('SELECT transaction_id FROM subscriptions WHERE id = ?').get(id) as
      | { transaction_id: number }
      | undefined
    if (sub?.transaction_id) {
      try {
        updateTransaction({ id: sub.transaction_id, is_recurring: false })
      } catch {
        // Linked transaction already deleted, ignore
      }
    }
    db().prepare('DELETE FROM subscriptions WHERE id = ?').run(id)
    return true
  })
  ipcMain.handle('subscriptions:link', (_, id: number) => {
    const sub = db().prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!sub) return { success: false, error: 'Subscription not found' }
    const tx = sub.transaction_id
      ? { success: false, error: 'Already linked to a transaction' }
      : (() => {
          const result = createTransaction({
            description: sub.name as string,
            amount: sub.amount as number,
            type: 'expense',
            account_id: normalizeAccountId(sub.account_id),
            date: new Date().toISOString().slice(0, 10),
            is_recurring: true
          })
          db().prepare('UPDATE subscriptions SET transaction_id = ? WHERE id = ?').run(result.id, id)
          return { success: true, transactionId: result.id }
        })()
    return tx
  })

  ipcMain.handle('subscriptions:unlink', (_, id: number) => {
    const sub = db().prepare('SELECT transaction_id FROM subscriptions WHERE id = ?').get(id) as
      | { transaction_id: number }
      | undefined
    if (sub?.transaction_id) {
      try {
        updateTransaction({ id: sub.transaction_id, is_recurring: false })
      } catch {
        // Linked transaction already deleted, ignore
      }
    }
    db().prepare('DELETE FROM subscriptions WHERE id = ?').run(id)
    return true
  })

  // Check subscriptions with past-due billing dates and auto-create transactions
  ipcMain.handle('subscriptions:checkBilling', () => {
    const now = getNow()
    const today = now.toISOString().slice(0, 10)
    const due = db().prepare(
      `SELECT * FROM subscriptions WHERE next_billing_date IS NOT NULL AND next_billing_date <= ?`
    ).all(today) as Array<{
      id: number
      name: string
      amount: number
      frequency: string
      next_billing_date: string
      account_id: number | null
    }>
    const created: number[] = []

    function advanceDate(dateStr: string, frequency: string): string {
      const [y, m, d] = dateStr.split('-').map(Number)
      if (frequency === 'yearly') {
        return `${y + 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      }
      if (frequency === 'weekly') {
        const dt = new Date(y, m - 1, d + 7)
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
      }
      if (frequency === 'fortnightly') {
        const dt = new Date(y, m - 1, d + 14)
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
      }
      return addMonths(dateStr, 1)
    }

    for (const sub of due) {
      // Check if a transaction already exists for this billing period
      const existingTx = db().prepare(
        `SELECT id FROM transactions WHERE notes = ? AND date = ? AND type = 'expense'`
      ).get(`subscription:${sub.id}`, sub.next_billing_date) as { id: number } | undefined

      if (!existingTx) {
        const result = createTransaction({
          description: sub.name,
          amount: sub.amount,
          type: 'expense',
          account_id: normalizeAccountId(sub.account_id),
          date: sub.next_billing_date,
          is_recurring: true,
          notes: `subscription:${sub.id}`
        })
        created.push(result.id)
      }

      // Advance next_billing_date by frequency — keep advancing if still past due
      let nextDate = sub.next_billing_date
      for (let i = 0; i < 12; i++) {
        nextDate = advanceDate(nextDate, sub.frequency)
        if (nextDate > today) break
      }

      db().prepare(
        'UPDATE subscriptions SET next_billing_date = ? WHERE id = ?'
      ).run(nextDate, sub.id)
    }

    return created
  })

  // Get upcoming subscription payments
  ipcMain.handle('subscriptions:upcoming', () => {
    const today = new Date().toISOString().slice(0, 10)
    return db().prepare(
      `SELECT s.*, t.description as transaction_description
       FROM subscriptions s
       LEFT JOIN transactions t ON s.transaction_id = t.id
       WHERE s.next_billing_date IS NOT NULL AND s.next_billing_date >= ?
       ORDER BY s.next_billing_date ASC
       LIMIT 5`
    ).all(today)
  })

  // Savings Sources
  ipcMain.handle('savings:sources', () => {
    return db()
      .prepare(
        `SELECT s.*, a.name as account_name
         FROM savings_sources s
         LEFT JOIN accounts a ON s.account_id = a.id
         ORDER BY s.id`
      )
      .all()
  })

  ipcMain.handle('savings:deleteSource', (_, id: number) => {
    const source = db().prepare('SELECT * FROM savings_sources WHERE id = ?').get(id) as
      | { transaction_id: number; description: string }
      | undefined
    if (!source) return false
    // Delete auto-created future transactions linked to this source
    const futureTxs = db().prepare(
      `SELECT id FROM transactions WHERE notes = ? AND date >= date('now')`
    ).all('savings_source:' + id) as { id: number }[]
    for (const tx of futureTxs) {
      deleteTransaction(tx.id)
    }
    // Delete linked subscription if any
    if (source.transaction_id) {
      db().prepare('DELETE FROM subscriptions WHERE transaction_id = ?').run(source.transaction_id)
    }
    db().prepare('DELETE FROM savings_sources WHERE id = ?').run(id)
    return true
  })

  ipcMain.handle('savings:populateFuture', () => {
    populateSavingsFuture(db())
    return true
  })

  ipcMain.handle('savings:checkBilling', () => {
    const now = getNow()
    const today = now.toISOString().slice(0, 10)
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    const sources = db().prepare('SELECT * FROM savings_sources').all() as Array<{
      id: number
      description: string
      amount: number
      category_id: number | null
      account_id: number | null
    }>
    const created: number[] = []
    for (const source of sources) {
      const notePattern = '%savings_source:' + source.id + '%'
      const noteMarker = 'savings_source:' + source.id
      const existing = db().prepare(
        `SELECT id FROM transactions WHERE notes LIKE ? AND strftime('%Y', date) = ? AND strftime('%m', date) = ?`
      ).get(notePattern, String(year), String(month).padStart(2, '0')) as { id: number } | undefined
      if (!existing) {
        let catId = source.category_id ?? getSavingsCategoryId(db())
        // Validate that the category still exists (savings_sources has no FK)
        if (catId !== null) {
          const catExists = db().prepare('SELECT 1 FROM categories WHERE id = ?').get(catId)
          if (!catExists) catId = getSavingsCategoryId(db())
        }
        const result = createTransaction({
          description: source.description,
          amount: source.amount,
          type: 'savings',
          account_id: normalizeAccountId(source.account_id),
          category_id: catId,
          date: today,
          is_recurring: false,
          notes: noteMarker
        })
        created.push(result.id)
      }
    }
    return created
  })

  // Income
  ipcMain.handle('income:sources', () =>
    db()
      .prepare(
        `SELECT s.*, a.name as account_name
         FROM income_sources s
         LEFT JOIN accounts a ON s.account_id = a.id`
      )
      .all()
  )
  ipcMain.handle('income:createSource', (_, src) => {
    const amount = Number.isFinite(src.amount) ? src.amount : 0
    const accountId = normalizeAccountId(src.accountId)
    const grossOrNet = src.grossOrNet === 'gross' ? 'gross' : src.isGross ? 'gross' : 'net'
    const frequency =
      src.frequency === 'weekly' ||
      src.frequency === 'fortnightly' ||
      src.frequency === 'yearly' ||
      src.frequency === 'monthly'
        ? src.frequency
        : 'monthly'
    const isRecurring = src.isRecurring !== false ? 1 : 0
    const r = db()
      .prepare(
        'INSERT INTO income_sources (name, amount, is_gross, gross_or_net, is_recurring, frequency, color, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        src.name,
        amount,
        grossOrNet === 'gross' ? 1 : 0,
        grossOrNet,
        isRecurring,
        frequency,
        src.color ?? '#22c55e',
        accountId
      )
    const newId = Number(r.lastInsertRowid)
    // Non-recurring: create entry + transaction scoped to current month only
    if (isRecurring === 0) {
      const now = new Date()
      const year = now.getFullYear()
      const month = now.getMonth() + 1
      const dateStr = now.toISOString().slice(0, 10)
      db().prepare(
        'INSERT OR IGNORE INTO income_entries (source_id, year, month, amount, is_irregular) VALUES (?, ?, ?, ?, 1)'
      ).run(newId, year, month, amount)
      createTransaction({
        description: src.name + ' (one-time)',
        amount,
        type: 'income',
        account_id: accountId,
        date: dateStr,
        is_recurring: false,
        notes: 'income_source:' + newId
      })
    }
    return { id: newId }
  })
  ipcMain.handle('income:updateSource', (_, src) => {
    const amount = Number.isFinite(src.amount) ? src.amount : 0
    const accountId = normalizeAccountId(src.accountId)
    const grossOrNet = src.grossOrNet === 'gross' ? 'gross' : src.isGross ? 'gross' : 'net'
    const frequency =
      src.frequency === 'weekly' ||
      src.frequency === 'fortnightly' ||
      src.frequency === 'yearly' ||
      src.frequency === 'monthly'
        ? src.frequency
        : 'monthly'
    const isRecurring = src.isRecurring !== false ? 1 : 0
    // Fetch old amount before updating — needed to update per-month entries
    const oldRow = db().prepare('SELECT amount FROM income_sources WHERE id = ?').get(src.id) as { amount: number } | undefined
    const oldAmount = oldRow?.amount ?? amount
    db()
      .prepare(
        'UPDATE income_sources SET name = ?, amount = ?, is_gross = ?, gross_or_net = ?, is_recurring = ?, frequency = ?, color = ?, account_id = ? WHERE id = ?'
      )
      .run(
        src.name,
        amount,
        grossOrNet === 'gross' ? 1 : 0,
        grossOrNet,
        isRecurring,
        frequency,
        src.color ?? '#22c55e',
        accountId,
        src.id
      )
    // Update all existing entries for this source (covers recurring 12-row and non-recurring 1-row)
    if (oldAmount > 0 && amount !== oldAmount) {
      db().prepare(
        'UPDATE income_entries SET amount = ? WHERE source_id = ?'
      ).run(amount, src.id)
      // Also update the linked transaction amount for non-recurring
      if (isRecurring === 0) {
        const existingTx = db().prepare("SELECT id FROM transactions WHERE notes = ?").get('income_source:' + src.id) as { id: number } | undefined
        if (existingTx) {
          updateTransaction({
            id: existingTx.id,
            description: src.name + ' (one-time)',
            amount,
            account_id: accountId,
            date: new Date().toISOString().slice(0, 10)
          })
        }
      }
    }
    // Non-recurring: ensure entry + transaction exist (covers toggle from recurring)
    if (isRecurring === 0) {
      const now = new Date()
      const year = now.getFullYear()
      const month = now.getMonth() + 1
      const dateStr = now.toISOString().slice(0, 10)
      db().prepare(
        'INSERT OR IGNORE INTO income_entries (source_id, year, month, amount, is_irregular) VALUES (?, ?, ?, ?, 1)'
      ).run(src.id, year, month, amount)
      const existingTx = db().prepare("SELECT id FROM transactions WHERE notes = ?").get('income_source:' + src.id) as { id: number } | undefined
      if (!existingTx) {
        createTransaction({
          description: src.name + ' (one-time)',
          amount,
          type: 'income',
          account_id: accountId,
          date: dateStr,
          is_recurring: false,
          notes: 'income_source:' + src.id
        })
      }
    }
    return true
  })
  ipcMain.handle('income:deleteSource', (_, id: number) => {
    // Delete linked transaction before deleting the source
    const existingTx = db().prepare("SELECT id FROM transactions WHERE notes = ?").get('income_source:' + id) as { id: number } | undefined
    if (existingTx) {
      deleteTransaction(existingTx.id)
    }
    db().prepare('DELETE FROM income_sources WHERE id = ?').run(id)
    return true
  })
  ipcMain.handle('income:entries', (_, year: number) => {
    return db()
      .prepare(
        `SELECT ie.*, s.name as source_name, s.color FROM income_entries ie
         JOIN income_sources s ON ie.source_id = s.id WHERE ie.year = ?`
      )
      .all(year)
  })
  ipcMain.handle('income:setEntry', (_, data) => {
    const amount = Number.isFinite(data.amount) ? data.amount : 0
    db()
      .prepare(
        `INSERT INTO income_entries (source_id, year, month, amount, is_irregular)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(source_id, year, month) DO UPDATE SET amount=excluded.amount, is_irregular=excluded.is_irregular`
      )
      .run(data.sourceId, data.year, data.month, amount, data.isIrregular ? 1 : 0)
    return true
  })

  ipcMain.handle('income:checkBilling', () => {
    const now = getNow()
    const today = now.toISOString().slice(0, 10)
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    const sources = db().prepare('SELECT * FROM income_sources WHERE is_recurring = 1').all() as Array<{
      id: number
      name: string
      amount: number
      frequency: string
      account_id: number | null
    }>
    const created: number[] = []

    function getOccurrencesForMonth(frequency: string): number {
      if (frequency === 'weekly') return 4
      if (frequency === 'fortnightly') return 2
      if (frequency === 'yearly') return 1
      return 1 // monthly
    }

    for (const source of sources) {
      const existingEntry = db().prepare(
        'SELECT id FROM income_entries WHERE source_id = ? AND year = ? AND month = ?'
      ).get(source.id, year, month) as { id: number } | undefined
      if (!existingEntry) {
        const occurrences = getOccurrencesForMonth(source.frequency)
        const monthlyAmount = Math.round(source.amount * occurrences * 100) / 100
        const noteMarker = 'income_source:' + source.id
        const result = createTransaction({
          description: source.name,
          amount: monthlyAmount,
          type: 'income',
          account_id: normalizeAccountId(source.account_id),
          date: today,
          is_recurring: false,
          notes: noteMarker
        })
        db().prepare(
          'INSERT OR IGNORE INTO income_entries (source_id, year, month, amount, is_irregular) VALUES (?, ?, ?, ?, 0)'
        ).run(source.id, year, month, monthlyAmount)
        created.push(result.id)
      }
    }
    return created
  })

  // Mood
  ipcMain.handle('mood:list', () => db().prepare('SELECT * FROM monthly_mood ORDER BY year, month').all())
  ipcMain.handle('mood:set', (_, data) => {
    db()
      .prepare(
        `INSERT INTO monthly_mood (year, month, rating, emoji) VALUES (?, ?, ?, ?)
         ON CONFLICT(year, month) DO UPDATE SET rating=excluded.rating, emoji=excluded.emoji`
      )
      .run(data.year, data.month, data.rating, data.emoji)
    return true
  })

  ipcMain.handle('habits:missedDays', () => {
    const dates = db()
      .prepare(
        `SELECT DISTINCT date FROM transactions
         WHERE date >= date('now', '-30 days')
         ORDER BY date`
      )
      .all() as { date: string }[]
    const tracked = new Set(dates.map((d) => d.date))
    const missed: string[] = []
    const today = new Date()
    for (let i = 1; i < 30; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      if (!tracked.has(key)) missed.push(key)
    }
    return missed
  })

  // Analytics aggregates
  ipcMain.handle('analytics:summary', (_, year: number) => {
    const monthly = db()
      .prepare(
        `SELECT strftime('%m', date) as month,
         SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expenses,
         SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income,
         SUM(CASE WHEN type='savings' THEN amount ELSE 0 END) as savings
         FROM transactions WHERE strftime('%Y', date) = ? GROUP BY month ORDER BY month`
      )
      .all(String(year))

    const byCategory = db()
      .prepare(
        `SELECT c.name, c.color, SUM(t.amount) as total
         FROM transactions t JOIN categories c ON t.category_id = c.id
         WHERE t.type = 'expense' AND strftime('%Y', t.date) = ?
         GROUP BY c.id ORDER BY total DESC`
      )
      .all(String(year))

    return { monthly, byCategory }
  })

  ipcMain.handle('analytics:mom', (_, year: number, month: number) => {
    const ym = String(month).padStart(2, '0')
    const prevMonth = month === 1 ? 12 : month - 1
    const prevYear = month === 1 ? year - 1 : year
    const prevYm = String(prevMonth).padStart(2, '0')

    const rows = db()
      .prepare(
        `SELECT c.id, c.name, c.color,
         COALESCE(SUM(CASE WHEN strftime('%m', t.date) = ? AND strftime('%Y', t.date) = ? THEN t.amount END), 0) as current,
         COALESCE(SUM(CASE WHEN strftime('%m', t.date) = ? AND strftime('%Y', t.date) = ? THEN t.amount END), 0) as previous
         FROM categories c
         LEFT JOIN transactions t ON t.category_id = c.id AND t.type = 'expense'
         GROUP BY c.id HAVING current > 0 OR previous > 0
         ORDER BY current DESC`
      )
      .all(ym, String(year), prevYm, String(prevYear)) as {
      id: number
      name: string
      color: string
      current: number
      previous: number
    }[]

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      total: r.current,
      change: r.previous > 0 ? ((r.current - r.previous) / r.previous) * 100 : r.current > 0 ? 100 : 0
    }))
  })

  ipcMain.handle('analytics:heatmap', (_, year: number) => {
    const rows = db()
      .prepare(
        `SELECT c.name, c.color, CAST(strftime('%m', t.date) AS INTEGER) as month,
         COALESCE(SUM(t.amount), 0) as total
         FROM categories c
         JOIN transactions t ON t.category_id = c.id AND t.type = 'expense' AND strftime('%Y', t.date) = ?
         GROUP BY c.id, month ORDER BY c.name, month`
      )
      .all(String(year)) as { name: string; color: string; month: number; total: number }[]

    const categories = [...new Set(rows.map((r) => r.name))]
    const months = [...new Set(rows.map((r) => r.month))].sort((a, b) => a - b)
    const cells: Record<string, Record<number, number>> = {}
    let max = 0
    for (const r of rows) {
      if (!cells[r.name]) cells[r.name] = {}
      cells[r.name][r.month] = r.total
      if (r.total > max) max = r.total
    }
    return { categories, months, cells, max, rows }
  })

  ipcMain.handle('analytics:yearOverYear', (_, currentYear: number, yearsBack = 3) => {
    const result: { year: number; expenses: number; income: number; savings: number }[] = []
    for (let offset = 0; offset < yearsBack; offset++) {
      const y = currentYear - offset
      const monthly = db()
        .prepare(
          `SELECT CAST(strftime('%m', date) AS INTEGER) as month,
           SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expenses,
           SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income,
           SUM(CASE WHEN type='savings' THEN amount ELSE 0 END) as savings
           FROM transactions WHERE strftime('%Y', date) = ? GROUP BY month ORDER BY month`
        )
        .all(String(y)) as { month: number; expenses: number; income: number; savings: number }[]
      result.push({
        year: y,
        expenses: monthly.reduce((s, m) => s + m.expenses, 0),
        income: monthly.reduce((s, m) => s + m.income, 0),
        savings: monthly.reduce((s, m) => s + m.savings, 0)
      })
    }
    return result
  })

  ipcMain.handle('analytics:breakEven', (_, year: number) => {
    const monthly = db()
      .prepare(
        `SELECT CAST(strftime('%m', date) AS INTEGER) as month,
         SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income,
         SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expenses
         FROM transactions WHERE strftime('%Y', date) = ? GROUP BY month ORDER BY month`
      )
      .all(String(year)) as { month: number; income: number; expenses: number }[]

    let cumulative = 0
    let breakEvenMonth: number | null = null
    const timeline = monthly.map((m) => {
      const net = m.income - m.expenses
      cumulative += net
      if (breakEvenMonth === null && cumulative <= 0 && net < 0) {
        breakEvenMonth = m.month
      }
      return { month: m.month, income: m.income, expenses: m.expenses, net, cumulative }
    })

    const irregularMonths = db()
      .prepare(
        `SELECT DISTINCT month FROM income_entries WHERE year = ? AND is_irregular = 1`
      )
      .all(year) as { month: number }[]

    return {
      timeline,
      breakEvenMonth,
      irregularMonths: irregularMonths.map((m) => m.month)
    }
  })

  ipcMain.handle('transactions:categoryTrend', (_, categoryId: number, year: number, anchorMonth: number, months = 6) => {
    const anchorPeriod = year * 12 + (anchorMonth - 1)
    const startPeriod = anchorPeriod - months + 1
    const rows = db()
      .prepare(
        `SELECT
         CAST(strftime('%Y', date) AS INTEGER) * 12 + (CAST(strftime('%m', date) AS INTEGER) - 1) as period,
         CAST(strftime('%m', date) AS INTEGER) as month,
         COALESCE(SUM(amount), 0) as spent
         FROM transactions
         WHERE category_id = ? AND type = 'expense'
           AND (CAST(strftime('%Y', date) AS INTEGER) * 12 + (CAST(strftime('%m', date) AS INTEGER) - 1)) BETWEEN ? AND ?
         GROUP BY period, month ORDER BY period`
      )
      .all(categoryId, startPeriod, anchorPeriod) as { period: number; month: number; spent: number }[]
    const map: Record<number, number> = {}
    for (const r of rows) map[r.period] = r.spent
    const result: { month: number; spent: number }[] = []
    for (let period = startPeriod; period <= anchorPeriod; period++) {
      result.push({ month: (period % 12) + 1, spent: map[period] || 0 })
    }
    return result
  })

  ipcMain.handle('transactions:categoryVariance', (_, categoryId: number, year: number, month: number) => {
    const current = addYearMonth(year, month, 0)
    const previous = addYearMonth(year, month, -1)
    const next = addYearMonth(year, month, 1)
    const currentStart = monthStart(current.year, current.month)
    const currentEnd = monthStart(next.year, next.month)
    const previousStart = monthStart(previous.year, previous.month)

    const rows = db()
      .prepare(
        `SELECT id, description, amount, date, is_recurring
         FROM transactions
         WHERE category_id = ?
           AND type IN ('expense', 'savings')
           AND date >= ?
           AND date < ?
         ORDER BY date DESC, id DESC`
      )
      .all(categoryId, previousStart, currentEnd) as Array<{
        id: number
        description: string
        amount: number
        date: string
        is_recurring: number
      }>

    const currentRows = rows.filter((row) => row.date >= currentStart && row.date < currentEnd)
    const previousRows = rows.filter((row) => row.date >= previousStart && row.date < currentStart)
    const currentTotal = roundCurrency(currentRows.reduce((sum, row) => sum + row.amount, 0))
    const previousTotal = roundCurrency(previousRows.reduce((sum, row) => sum + row.amount, 0))
    const delta = roundCurrency(currentTotal - previousTotal)
    const changePercent = previousTotal > 0 ? Math.round((delta / previousTotal) * 100) : currentTotal > 0 ? 100 : 0

    const currentMerchants = new Map<string, { name: string; total: number; count: number; recurring: boolean }>()
    const previousMerchants = new Map<string, { name: string; total: number; count: number; recurring: boolean }>()
    for (const row of currentRows) {
      const key = normalizeMerchantName(row.description)
      const existing = currentMerchants.get(key) ?? { name: row.description.trim(), total: 0, count: 0, recurring: false }
      existing.total += row.amount
      existing.count += 1
      existing.recurring = existing.recurring || row.is_recurring === 1
      currentMerchants.set(key, existing)
    }
    for (const row of previousRows) {
      const key = normalizeMerchantName(row.description)
      const existing = previousMerchants.get(key) ?? { name: row.description.trim(), total: 0, count: 0, recurring: false }
      existing.total += row.amount
      existing.count += 1
      existing.recurring = existing.recurring || row.is_recurring === 1
      previousMerchants.set(key, existing)
    }

    const drivers: string[] = []
    const newMerchant = [...currentMerchants.entries()]
      .filter(([key]) => !previousMerchants.has(key))
      .sort((a, b) => b[1].total - a[1].total)[0]?.[1]
    if (newMerchant && newMerchant.total >= Math.max(100, Math.abs(delta) * 0.25)) {
      drivers.push(`${newMerchant.name} appears this month for ${roundCurrency(newMerchant.total)}.`)
    }

    const currentLargest = [...currentRows].sort((a, b) => b.amount - a.amount)[0]
    const previousLargest = [...previousRows].sort((a, b) => b.amount - a.amount)[0]
    const currentAverage = currentRows.length ? currentTotal / currentRows.length : 0
    if (
      currentLargest &&
      currentLargest.amount >= Math.max(currentAverage * 1.5, (previousLargest?.amount ?? 0) * 1.35, 100)
    ) {
      drivers.push(`${currentLargest.description} is the largest transaction at ${roundCurrency(currentLargest.amount)}.`)
    }

    if (currentRows.length >= previousRows.length + 2) {
      drivers.push(`There are ${currentRows.length} transactions this month versus ${previousRows.length} last month.`)
    } else if (previousRows.length >= currentRows.length + 2) {
      drivers.push(`There are fewer transactions this month (${currentRows.length}) than last month (${previousRows.length}).`)
    }

    const recurringStarted = [...currentMerchants.entries()]
      .find(([key, merchant]) => merchant.recurring && !previousMerchants.get(key)?.recurring)?.[1]
    const recurringStopped = [...previousMerchants.entries()]
      .find(([key, merchant]) => merchant.recurring && !currentMerchants.get(key)?.recurring)?.[1]
    if (recurringStarted) {
      drivers.push(`${recurringStarted.name} is marked recurring this month and was not recurring here last month.`)
    } else if (recurringStopped) {
      drivers.push(`${recurringStopped.name} was recurring last month but is not present as recurring this month.`)
    }

    const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
    const summary =
      direction === 'flat'
        ? `This category is unchanged from last month at ${roundCurrency(currentTotal)}.`
        : `This category is ${direction} ${roundCurrency(Math.abs(delta))} from last month (${changePercent}%).`

    return {
      currentTotal,
      previousTotal,
      delta,
      changePercent,
      direction,
      explanation: drivers.length ? `${summary} ${drivers.slice(0, 2).join(' ')}` : summary,
      drivers
    }
  })

  ipcMain.handle('transactions:recurringMerchantPatterns', (_, year: number, month: number) => {
    const start = addYearMonth(year, month, -5)
    const end = addYearMonth(year, month, 1)
    const startDate = monthStart(start.year, start.month)
    const endDate = monthStart(end.year, end.month)
    const ignoredRow = db().prepare("SELECT value FROM settings WHERE key = 'recurringMerchantIgnores'").get() as
      | { value: string }
      | undefined
    const ignored = ignoredRow ? JSON.parse(ignoredRow.value) as Record<string, boolean> : {}
    const rows = db()
      .prepare(
        `SELECT t.id, t.description, t.amount, t.date, t.category_id, c.name as category_name
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.type = 'expense'
           AND t.category_id IS NOT NULL
           AND t.date >= ?
           AND t.date < ?
           AND (t.notes IS NULL OR t.notes NOT LIKE 'subscription:%')
           AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.transaction_id = t.id)
         ORDER BY t.date ASC, t.id ASC`
      )
      .all(startDate, endDate) as Array<{
        id: number
        description: string
        amount: number
        date: string
        category_id: number
        category_name: string | null
      }>

    const groups = new Map<string, {
      merchant: string
      normalizedMerchant: string
      categoryId: number
      categoryName: string
      transactions: Array<{ id: number; amount: number; date: string; description: string }>
    }>()
    for (const row of rows) {
      const normalizedMerchant = normalizeMerchantName(row.description)
      const key = `${normalizedMerchant}|${row.category_id}`
      if (ignored[key]) continue
      const existing = groups.get(key) ?? {
        merchant: row.description.trim(),
        normalizedMerchant,
        categoryId: row.category_id,
        categoryName: row.category_name ?? 'Uncategorized',
        transactions: []
      }
      existing.transactions.push({
        id: row.id,
        amount: row.amount,
        date: row.date,
        description: row.description
      })
      groups.set(key, existing)
    }

    return [...groups.entries()]
      .filter(([, group]) => group.transactions.length >= 4)
      .map(([key, group]) => {
        const total = roundCurrency(group.transactions.reduce((sum, tx) => sum + tx.amount, 0))
        const average = roundCurrency(total / group.transactions.length)
        return {
          key,
          merchant: group.merchant,
          normalizedMerchant: group.normalizedMerchant,
          categoryId: group.categoryId,
          categoryName: group.categoryName,
          count: group.transactions.length,
          total,
          average,
          firstDate: group.transactions[0]?.date,
          lastDate: group.transactions[group.transactions.length - 1]?.date
        }
      })
      .sort((a, b) => b.total - a.total)
  })

  ipcMain.handle('transactions:dismissRecurringMerchantPattern', (_, key: string) => {
    const row = db().prepare("SELECT value FROM settings WHERE key = 'recurringMerchantIgnores'").get() as
      | { value: string }
      | undefined
    const ignored = row ? JSON.parse(row.value) as Record<string, boolean> : {}
    ignored[key] = true
    db().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('recurringMerchantIgnores', ?)").run(JSON.stringify(ignored))
    return true
  })

  ipcMain.handle('transactions:search', (_, query: string, limit = 20) => {
    return db()
      .prepare(
        `SELECT t.id, t.description, t.amount, t.date, t.type, c.name as category_name, a.name as account_name
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         LEFT JOIN accounts a ON t.account_id = a.id
         WHERE t.description LIKE ? ORDER BY t.date DESC LIMIT ?`
      )
      .all(`%${query}%`, limit)
  })

  ipcMain.handle('dashboard:stats', (_, year: number, month: number) => {
    const ym = { y: String(year), m: String(month).padStart(2, '0') }
    const spending = db()
      .prepare(
        `SELECT COALESCE(SUM(amount),0) as v FROM transactions
         WHERE type='expense' AND strftime('%Y',date)=? AND strftime('%m',date)=?`
      )
      .get(ym.y, ym.m) as { v: number }
    const income = db()
      .prepare(
        `SELECT COALESCE(SUM(amount),0) as v FROM transactions
         WHERE type='income' AND strftime('%Y',date)=? AND strftime('%m',date)=?`
      )
      .get(ym.y, ym.m) as { v: number }
    const savings = db()
      .prepare(
        `SELECT COALESCE(SUM(amount),0) as v FROM transactions
         WHERE type='savings' AND strftime('%Y',date)=? AND strftime('%m',date)=?`
      )
      .get(ym.y, ym.m) as { v: number }

    const wealth = db().prepare('SELECT * FROM wealth_snapshots ORDER BY date DESC LIMIT 1').get() as
      | Record<string, number>
      | undefined
    let netWorth = 0
    if (wealth) {
      netWorth =
        (wealth.assets_savings || 0) +
        (wealth.assets_investments || 0) +
        (wealth.assets_property || 0) -
        (wealth.liabilities_loans || 0) -
        (wealth.liabilities_credit || 0)
    }

    const savingsRate = income.v > 0 ? ((income.v - spending.v) / income.v) * 100 : 0
    const streak = db().prepare("SELECT value FROM settings WHERE key = 'spendingStreak'").get() as
      | { value: string }
      | undefined
    const streakData = streak ? JSON.parse(streak.value) : { current: 0, longest: 0 }

    const categoryMonth = db()
      .prepare(
        `SELECT c.name, c.color, COALESCE(SUM(t.amount),0) as value
         FROM categories c LEFT JOIN transactions t ON t.category_id=c.id
         AND t.type='expense' AND strftime('%Y',t.date)=? AND strftime('%m',t.date)=?
         GROUP BY c.id HAVING value > 0`
      )
      .all(ym.y, ym.m)

    const monthlyTrend = db()
      .prepare(
        `SELECT strftime('%m',date) as month,
         SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expenses,
         SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income,
         SUM(CASE WHEN type='savings' THEN amount ELSE 0 END) as savings
         FROM transactions WHERE strftime('%Y',date)=? GROUP BY month`
      )
      .all(ym.y)

    const savingsByMonth = (
      monthlyTrend as { month: string; expenses: number; income: number; savings: number }[]
    ).map((row) => ({
      month: row.month,
      rate: row.income > 0 ? ((row.income - row.expenses) / row.income) * 100 : 0
    }))

    // Get goals with calculated current_amount (same logic as goals:list)
    const rawGoals = db().prepare('SELECT * FROM goals').all() as Array<{
      id: number
      type: string
      name: string
      current_amount: number
      target_amount: number
    }>

    const goals = rawGoals.map((g) => ({ ...g, current_amount: getGoalCurrentAmount(db(), g.type) }))

    const budgetTotal = db()
      .prepare('SELECT COALESCE(SUM(amount),0) as v FROM budget_entries WHERE year=? AND month=?')
      .get(year, month) as { v: number }

    const budgetHealth = calculateBudgetHealth(
      savingsRate,
      goals as { target_amount: number; current_amount: number }[],
      spending.v,
      budgetTotal.v
    )

    const insights = db()
      .prepare('SELECT * FROM ai_insights ORDER BY created_at DESC LIMIT 3')
      .all()

    return {
      netWorth,
      spending: spending.v,
      income: income.v,
      savings: savings.v,
      savingsRate,
      streak: streakData,
      categoryMonth,
      monthlyTrend,
      savingsByMonth,
      budgetHealth,
      insights
    }
  })

  ipcMain.handle('dashboard:cashFlowForecast', (_, year: number, month: number) => {
    const profileRow = db().prepare("SELECT value FROM settings WHERE key = 'profile'").get() as
      | { value: string }
      | undefined
    const profile = profileRow ? JSON.parse(profileRow.value) as { taxWithheldPercent?: number } : {}
    const taxPercent = Number(profile.taxWithheldPercent ?? 30)

    const incomeSources = db().prepare('SELECT * FROM income_sources WHERE is_recurring = 1').all() as Array<{
      id: number
      amount: number
      is_gross?: number
      gross_or_net?: string
      frequency?: string
    }>
    const incomeEntries = db().prepare('SELECT * FROM income_entries WHERE year BETWEEN ? AND ?').all(year, year + 1) as Array<{
      source_id: number
      year: number
      month: number
      amount: number
    }>
    const subscriptions = db().prepare('SELECT * FROM subscriptions WHERE COALESCE(on_hold, 0) = 0').all() as Array<{
      amount: number
      frequency: string
    }>
    const savingsSources = db().prepare('SELECT * FROM savings_sources WHERE COALESCE(is_recurring, 1) = 1').all() as Array<{
      amount: number
      frequency?: string
    }>

    const subscriptionMonthly = subscriptions.reduce((sum, sub) => sum + monthlyAmount(sub.amount, sub.frequency), 0)
    const savingsMonthly = savingsSources.reduce((sum, source) => sum + monthlyAmount(source.amount, source.frequency ?? 'monthly'), 0)

    const anchor = addYearMonth(year, month, -3)
    const anchorStart = monthStart(anchor.year, anchor.month)
    const currentStart = monthStart(year, month)
    const recentVariable = db()
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as v
         FROM transactions
         WHERE type = 'expense'
           AND date >= ?
           AND date < ?
           AND COALESCE(is_recurring, 0) = 0
           AND (notes IS NULL OR notes NOT LIKE 'subscription:%')`
      )
      .get(anchorStart, currentStart) as { v: number }
    const recentVariableAverage = roundCurrency(recentVariable.v / 3)

    return [1, 2, 3].map((offset) => {
      const target = addYearMonth(year, month, offset)
      const projectedIncome = incomeSources.reduce((sum, source) => {
        const entry = incomeEntries.find((row) => row.source_id === source.id && row.year === target.year && row.month === target.month)
        const rawAmount = entry?.amount ?? source.amount
        const monthly = monthlyAmount(rawAmount, source.frequency ?? 'monthly')
        const mode = source.gross_or_net ?? (source.is_gross ? 'gross' : 'net')
        return sum + (mode === 'gross' ? netFromGross(monthly, taxPercent) : monthly)
      }, 0)

      const budgetedOutflow = db()
        .prepare('SELECT COALESCE(SUM(amount), 0) as v FROM budget_entries WHERE year = ? AND month = ?')
        .get(target.year, target.month) as { v: number }
      const variableOutflow = Math.max(budgetedOutflow.v, recentVariableAverage)
      const projectedOutflow = variableOutflow + subscriptionMonthly + savingsMonthly
      const projectedBalance = roundCurrency(projectedIncome - projectedOutflow)
      const balancePercent = projectedIncome > 0 ? Math.round((projectedBalance / projectedIncome) * 100) : 0
      const tier = budgetHealthTier(balancePercent, projectedBalance < 0)

      return {
        year: target.year,
        month: target.month,
        projectedIncome: roundCurrency(projectedIncome),
        budgetedOutflow: roundCurrency(budgetedOutflow.v),
        recentVariableAverage,
        variableOutflow: roundCurrency(variableOutflow),
        subscriptionOutflow: roundCurrency(subscriptionMonthly),
        savingsOutflow: roundCurrency(savingsMonthly),
        projectedOutflow: roundCurrency(projectedOutflow),
        projectedBalance,
        balancePercent,
        tier
      }
    })
  })

  // Backup
  ipcMain.handle('data:exportDb', async () => {
    const win = getWindow()
    // Snapshot DB path before yielding to event loop
    const dbPath = getDbPath()
    const result = await dialog.showSaveDialog(win!, {
      title: 'Export database',
      defaultPath: `budget-backup-${Date.now()}.db`,
      filters: [{ name: 'SQLite', extensions: ['db'] }]
    })
    if (!result.canceled && result.filePath) {
      copyFileSync(dbPath, result.filePath)
      return result.filePath
    }
    return null
  })

  ipcMain.handle('data:exportJson', async () => {
    const win = getWindow()
    const result = await dialog.showSaveDialog(win!, {
      title: 'Export JSON backup',
      defaultPath: `budget-backup-${Date.now()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (!result.canceled && result.filePath) {
      const dump = exportAllTables()
      writeFileSync(result.filePath, JSON.stringify(dump, null, 2))
      return result.filePath
    }
    return null
  })

  ipcMain.handle('data:importDb', async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Import database backup',
      filters: [{ name: 'SQLite', extensions: ['db'] }],
      properties: ['openFile']
    })
    if (!result.canceled && result.filePaths[0]) {
      const dbPath = getDbPath()
      copyFileSync(result.filePaths[0], dbPath)
      return true
    }
    return false
  })

  ipcMain.handle('data:importJson', async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Import JSON backup',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (!result.canceled && result.filePaths[0]) {
      try {
        const data = JSON.parse(readFileSync(result.filePaths[0], 'utf8'))
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          throw new Error('Invalid backup format: expected an object with table keys')
        }
        importAllTables(data)
        return true
      } catch (error) {
        console.error('Failed to import JSON backup:', error)
        throw error
      }
    }
    return false
  })

  ipcMain.handle('data:wipe', () => {
    const database = db()
    const tx = database.transaction(() => {
      const tables = [
        'transactions',
        'transaction_events',
        'budget_entries',
        'categories',
        'goals',
        'wealth_snapshots',
        'investments',
        'investment_holdings',
        'subscriptions',
        'savings_sources',
        'income_entries',
        'income_sources',
        'monthly_mood',
        'ai_insights',
        'household_members',
        'currency_cache',
        'integrity_warnings',
        'accounts'
      ]
      for (const t of tables) database.prepare(`DELETE FROM ${t}`).run()
      database
        .prepare("INSERT INTO accounts (name, type, currency, is_archived) VALUES ('Main', 'checking', 'SEK', 0)")
        .run()
      // Reset onboarding
      database.prepare("DELETE FROM settings WHERE key = 'onboardingComplete'").run()
      const currentYear = new Date().getFullYear()
      database
        .prepare(
          `INSERT OR REPLACE INTO settings (key, value) VALUES
          ('profile', ?),
          ('spendingStreak', ?)`
        )
        .run(
          JSON.stringify({
            name: '', currency: 'SEK', displayCurrency: 'SEK', baseCurrency: 'SEK', cpiPercent: 2.5,
            taxWithheldPercent: 30, theme: 'system', year: currentYear,
            autoHideZeroCategories: false, notificationsEnabled: true, grossIncomeToggle: false,
            savingsRateTarget: 20, colorBlindMode: false, locale: 'sv-SE'
          }),
          JSON.stringify({ current: 0, longest: 0, lastDate: null })
        )
      // Recreate default categories so the app doesn't break
      const defaultCategories = [
        { name: 'Savings', icon: 'piggy-bank', color: '#22c55e', goal_type: 'savings', sort_order: 100 },
        { name: 'Emergency Fund', icon: 'shield', color: '#3b82f6', goal_type: 'emergency', sort_order: 101 },
        { name: 'Debt Payoff', icon: 'credit-card', color: '#ef4444', goal_type: 'debt', sort_order: 102 },
        { name: 'FIRE Number', icon: 'flame', color: '#f59e0b', goal_type: 'fire', sort_order: 103 },
        { name: 'Investments', icon: 'trending-up', color: '#8b5cf6', goal_type: 'investment', sort_order: 104 }
      ]
      const insert = database.prepare('INSERT INTO categories (name, icon, color, goal_type, sort_order) VALUES (?, ?, ?, ?, ?)')
      for (const cat of defaultCategories) {
        insert.run(cat.name, cat.icon, cat.color, cat.goal_type, cat.sort_order)
      }
      return true
    })
    return tx()
  })

  ipcMain.handle('data:repairFromEvents', () => {
    try {
      const count = rebuildTransactionsProjection()
      return { success: true, count }
    } catch (error) {
      console.error('Repair failed:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  ipcMain.handle('ai:saveInsight', (_, content: string, year: number, month: number) => {
    db()
      .prepare('INSERT INTO ai_insights (type, content, year, month) VALUES (?, ?, ?, ?)')
      .run('dashboard', content, year, month)
    return true
  })

  ipcMain.handle('reports:yearSummary', (_, year: number) => {
    const y = String(year)
    const monthly = db()
      .prepare(
        `SELECT CAST(strftime('%m', date) AS INTEGER) as month,
         SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expenses,
         SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income
         FROM transactions WHERE strftime('%Y', date) = ? GROUP BY month ORDER BY month`
      )
      .all(y) as { month: number; expenses: number; income: number }[]

    const totalExpenses = monthly.reduce((s, m) => s + m.expenses, 0)
    const totalIncome = monthly.reduce((s, m) => s + m.income, 0)
    const netSavings = totalIncome - totalExpenses
    const savingsRate = totalIncome > 0 ? (netSavings / totalIncome) * 100 : 0

    const topCategories = db()
      .prepare(
        `SELECT c.name, c.color, SUM(t.amount) as total
         FROM transactions t JOIN categories c ON t.category_id = c.id
         WHERE t.type = 'expense' AND strftime('%Y', t.date) = ?
         GROUP BY c.id ORDER BY total DESC LIMIT 8`
      )
      .all(y)

    const goals = db().prepare('SELECT * FROM goals').all()
    const subscriptions = db().prepare(`SELECT COALESCE(SUM(CASE WHEN frequency='annual' OR frequency='yearly' THEN CAST(amount AS REAL)/12.0 ELSE amount END),0) as total FROM subscriptions WHERE transaction_id IS NULL`).get() as
      | { total: number }
      | undefined
    const txCount = db()
      .prepare(`SELECT COUNT(*) as c FROM transactions WHERE strftime('%Y', date) = ?`)
      .get(y) as { c: number }

    const wealth = db().prepare('SELECT * FROM wealth_snapshots ORDER BY date DESC LIMIT 1').get() as
      | Record<string, number>
      | undefined
    let netWorth = 0
    if (wealth) {
      netWorth =
        (wealth.assets_savings || 0) +
        (wealth.assets_investments || 0) +
        (wealth.assets_property || 0) -
        (wealth.liabilities_loans || 0) -
        (wealth.liabilities_credit || 0)
    }

    const profile = db().prepare("SELECT value FROM settings WHERE key = 'profile'").get() as
      | { value: string }
      | undefined
    const profileData = profile ? JSON.parse(profile.value) : { name: '' }

    const streak = db().prepare("SELECT value FROM settings WHERE key = 'spendingStreak'").get() as
      | { value: string }
      | undefined
    const streakData = streak ? JSON.parse(streak.value) : { current: 0, longest: 0 }

    return {
      year,
      profile: profileData,
      monthly,
      totalExpenses,
      totalIncome,
      netSavings,
      savingsRate,
      topCategories,
      goals,
      subscriptionMonthly: subscriptions?.total ?? 0,
      transactionCount: txCount.c,
      netWorth,
      streak: streakData
    }
  })

  ipcMain.handle('goals:emergencyTarget', () => {
    const avg = db()
      .prepare(
        `SELECT COALESCE(AVG(monthly), 0) as avg FROM (
           SELECT SUM(amount) as monthly FROM transactions
           WHERE type = 'expense' AND date >= date('now', '-12 months')
           GROUP BY strftime('%Y-%m', date)
         )`
      )
      .get() as { avg: number }
    return Math.round(avg.avg * 3)
  })

  // Pension projection
  ipcMain.handle('pension:get', () => {
    const row = db().prepare("SELECT value FROM settings WHERE key = 'pension'").get() as { value: string } | undefined
    if (!row) return null
    try { return JSON.parse(row.value) } catch { return null }
  })
  ipcMain.handle('pension:save', (_, data) => {
    db().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pension', ?)").run(JSON.stringify(data))
    return true
  })

  ipcMain.handle('print:yearSummary', () => {
    const win = getWindow()
    win?.webContents.print({ silent: false, printBackground: true })
  })
}

function getSavingsCategoryId(database: ReturnType<typeof getDatabase>): number | null {
  const row = database.prepare("SELECT id FROM categories WHERE goal_type = 'savings' LIMIT 1").get() as
    | { id: number }
    | undefined
  return row?.id ?? null
}

function populateSavingsFuture(_database: ReturnType<typeof getDatabase>): void {
  // No-op — savings sources appear as blue cards in the Recurring tab
  // but do not auto-create transactions or budget entries.
}

function updateSpendingStreak(date: string): void {
  const db = getDatabase()
  const row = db.prepare("SELECT value FROM settings WHERE key = 'spendingStreak'").get() as
    | { value: string }
    | undefined
  const streak = row ? JSON.parse(row.value) : { current: 0, longest: 0, lastDate: null }
  const today = date.slice(0, 10)
  const last = streak.lastDate
  if (last) {
    const diff = (Date.parse(today) - Date.parse(last)) / 86400000
    if (diff === 1) streak.current += 1
    else if (diff > 1) streak.current = 1
  } else {
    streak.current = 1
  }
  streak.longest = Math.max(streak.longest, streak.current)
  streak.lastDate = today
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('spendingStreak', ?)").run(
    JSON.stringify(streak)
  )
}

function calculateBudgetHealth(
  savingsRate: number,
  goals: { target_amount: number; current_amount: number }[],
  spent: number,
  budgeted: number
): number {
  let score = 50
  if (savingsRate >= 20) score += 20
  else if (savingsRate >= 10) score += 10
  else if (savingsRate < 0) score -= 15

  if (budgeted > 0) {
    const adherence = spent <= budgeted ? 1 - spent / budgeted : 0
    score += adherence * 20
    if (spent > budgeted) score -= 10
  }

  if (goals.length) {
    const progress =
      goals.reduce((s, g) => s + Math.min(g.target_amount > 0 ? g.current_amount / g.target_amount : 0, 1), 0) /
      goals.length
    score += progress * 10
  }

  return Math.max(0, Math.min(100, Math.round(score)))
}

function getGoalCurrentAmount(database: ReturnType<typeof getDatabase>, goalType: string): number {
  if (goalType === 'investment') {
    const total = database
      .prepare('SELECT COALESCE(SUM(current_value), 0) as v FROM investment_holdings')
      .get() as { v: number }
    return total.v
  }

  if (goalType === 'debt') {
    const category = database.prepare("SELECT id FROM categories WHERE goal_type='debt'").get() as
      | { id: number }
      | undefined
    if (category) {
      const total = database
        .prepare(`SELECT COALESCE(SUM(amount), 0) as v FROM transactions WHERE category_id=? AND type='transfer'`)
        .get(category.id) as { v: number }
      return total.v
    }
  }

  if (goalType === 'savings' || goalType === 'emergency' || goalType === 'fire') {
    const totalSaved = database
      .prepare(`SELECT COALESCE(SUM(amount), 0) as v FROM transactions WHERE type='savings'`)
      .get() as { v: number }
    return totalSaved.v
  }

  return 0
}

function exportAllTables(): Record<string, unknown[]> {
  const database = getDatabase()
  const tables = [
    'settings',
    'household_members',
    'accounts',
    'categories',
    'transactions',
    'budget_entries',
    'goals',
    'wealth_snapshots',
    'investments',
    'investment_holdings',
    'subscriptions',
    'savings_sources',
    'income_sources',
    'income_entries',
    'monthly_mood',
    'ai_insights',
    'currency_cache',
    'integrity_warnings'
  ]
  const dump: Record<string, unknown[]> = {}
  for (const t of tables) {
    dump[t] = database.prepare(`SELECT * FROM ${t}`).all()
  }
  return dump
}

function importAllTables(data: Record<string, unknown[]>): void {
  const database = getDatabase()
  const tx = database.transaction((txData: Record<string, unknown[]>) => {
    const order = [
      'household_members',
      'accounts',
      'categories',
      'goals',
      'wealth_snapshots',
      'investments',
      'investment_holdings',
      'subscriptions',
      'savings_sources',
      'income_sources',
      'income_entries',
      'monthly_mood',
      'ai_insights',
      'transactions',
      'transaction_events',
      'currency_cache',
      'integrity_warnings',
      'settings'
    ]
    for (const table of order) {
      const rows = txData[table]
      if (!rows?.length) continue
      database.prepare(`DELETE FROM ${table}`).run()
      const cols = Object.keys(rows[0] as object)
      const placeholders = cols.map(() => '?').join(',')
      const insert = database.prepare(
        `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`
      )
      for (const row of rows) {
        insert.run(...cols.map((c) => (row as Record<string, unknown>)[c]))
      }
    }
  })
  tx(data)
}
