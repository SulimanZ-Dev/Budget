import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { copyFileSync, readFileSync, writeFileSync, existsSync, rmSync } from 'fs'
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
  exportTransactionsToCsv,
  type CsvMapping,
  type TransactionRow
} from '../services/csv-import'
import { parseOfx } from '../services/ofx-import'
import { registerFinancialToolsHandlers } from './financial-tools-handlers'
import { assertYearMonthOpen } from '../services/month-lock'
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
  rebuildTransactionsProjection,
  findDuplicateTransactions
} from '../commands/transaction-commands'
import {
  getTransactions,
  getTransactionHistory,
  verifyTransactionIntegrity
} from '../queries/transaction-queries'

type GetWindow = () => BrowserWindow | null
type TransactionFilters = Record<string, unknown>
type ForecastTier = 'success' | 'warning' | 'destructive'

const DATA_TABLES = [
  'debt_payments',
  'transaction_attachments',
  'transaction_tags',
  'transaction_splits',
  'transaction_links',
  'shared_expenses',
  'account_reconciliations',
  'budget_rollover',
  'saved_filters',
  'merchant_aliases',
  'closed_months',
  'transaction_events',
  'budget_entries',
  'categorization_rules',
  'subscriptions',
  'savings_sources',
  'income_entries',
  'income_sources',
  'tax_estimates',
  'tax_year_settings',
  'monthly_mood',
  'ai_insights',
  'wealth_snapshots',
  'investment_holdings',
  'investments',
  'transactions',
  'goals',
  'household_members',
  'currency_cache',
  'integrity_warnings',
  'tags',
  'categories',
  'accounts'
] as const

const BACKUP_TABLES = ['settings', ...DATA_TABLES] as const

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

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null
  const target = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(target.getTime())) return null
  const today = new Date(`${isoDate(getNow())}T00:00:00`)
  return Math.ceil((target.getTime() - today.getTime()) / 86400000)
}

function previousYearMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value)
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [
    headers.map(csvCell).join(','),
    ...rows.map((row) => row.map(csvCell).join(','))
  ].join('\n') + '\n'
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

type RuleOperator = 'AND' | 'OR'
type RuleConditionType = 'description_contains' | 'amount_min' | 'amount_max' | 'category_is' | 'type_is'
type RuleNode =
  | { kind: 'condition'; type: RuleConditionType; value: string | number }
  | { kind: 'group'; operator: RuleOperator; children: RuleNode[] }

interface CategorizationRuleRow {
  id: number
  pattern: string
  category_id: number
  priority: number | null
  apply_future_only: number | null
  conditions_json: string | null
}

interface RuleTransactionLike {
  description: string
  amount: number
  type?: string | null
  category_id?: number | null
}

function legacyRuleNode(pattern: string): RuleNode {
  return { kind: 'condition', type: 'description_contains', value: pattern }
}

function parseRuleNode(rule: CategorizationRuleRow): RuleNode {
  if (!rule.conditions_json) return legacyRuleNode(rule.pattern)
  try {
    const parsed = JSON.parse(rule.conditions_json) as RuleNode
    return parsed?.kind ? parsed : legacyRuleNode(rule.pattern)
  } catch {
    return legacyRuleNode(rule.pattern)
  }
}

function matchesRuleNode(node: RuleNode, tx: RuleTransactionLike): boolean {
  if (node.kind === 'group') {
    const children = node.children ?? []
    if (children.length === 0) return false
    return node.operator === 'OR'
      ? children.some((child) => matchesRuleNode(child, tx))
      : children.every((child) => matchesRuleNode(child, tx))
  }

  if (node.type === 'description_contains') {
    return tx.description.toLowerCase().includes(String(node.value).trim().toLowerCase())
  }
  if (node.type === 'amount_min') return tx.amount >= Number(node.value)
  if (node.type === 'amount_max') return tx.amount <= Number(node.value)
  if (node.type === 'category_is') return tx.category_id === Number(node.value)
  if (node.type === 'type_is') return tx.type === String(node.value)
  return false
}

function getCategorizationRules(database = getDatabase()): CategorizationRuleRow[] {
  return database
    .prepare('SELECT * FROM categorization_rules ORDER BY priority ASC, id ASC')
    .all() as CategorizationRuleRow[]
}

function matchingRuleCategoryId(
  tx: RuleTransactionLike,
  options: { includeFutureOnly: boolean },
  database = getDatabase()
): number | null {
  for (const rule of getCategorizationRules(database)) {
    if (!options.includeFutureOnly && rule.apply_future_only === 1) continue
    if (matchesRuleNode(parseRuleNode(rule), tx)) return rule.category_id
  }
  return null
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
    sql += ' AND (t.category_id = ? OR EXISTS (SELECT 1 FROM transaction_splits ts WHERE ts.transaction_id=t.id AND ts.category_id=?))'
    params.push(filters.categoryId)
    params.push(filters.categoryId)
  }
  if (filters?.type) {
    sql += ' AND t.type = ?'
    params.push(filters.type)
  }
  if (filters?.accountId) {
    sql += ' AND (t.account_id = ? OR t.transfer_account_id = ?)'
    params.push(filters.accountId, filters.accountId)
  }
  if (filters?.flagged) {
    sql += ' AND t.is_unnecessary = 1'
  }
  if (filters?.search) {
    sql += ` AND (t.description LIKE ? COLLATE NOCASE OR t.merchant_name LIKE ? COLLATE NOCASE
      OR t.notes LIKE ? COLLATE NOCASE OR EXISTS (
        SELECT 1 FROM transaction_tags tt JOIN tags tg ON tg.id=tt.tag_id
        WHERE tt.transaction_id=t.id AND tg.name LIKE ? COLLATE NOCASE
      ))`
    const pattern = `%${filters.search}%`
    params.push(pattern, pattern, pattern, pattern)
  }
  if (filters?.recurring === true) {
    sql += ' AND t.is_recurring = 1'
  }
  if (filters?.recurring === false) {
    sql += ' AND t.is_recurring = 0'
  }
  if (Number.isFinite(Number(filters?.minAmount))) {
    sql += ' AND t.amount >= ?'
    params.push(Number(filters?.minAmount))
  }
  if (Number.isFinite(Number(filters?.maxAmount))) {
    sql += ' AND t.amount <= ?'
    params.push(Number(filters?.maxAmount))
  }
  if (filters?.dateFrom) {
    sql += ' AND t.date >= ?'
    params.push(filters.dateFrom)
  }
  if (filters?.dateTo) {
    sql += ' AND t.date <= ?'
    params.push(filters.dateTo)
  }
  if (filters?.tagId) {
    sql += ' AND EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id=t.id AND tt.tag_id=?)'
    params.push(filters.tagId)
  }
  if (filters?.reconciled === true) sql += ' AND COALESCE(t.reconciled,0)=1'
  if (filters?.reconciled === false) sql += ' AND COALESCE(t.reconciled,0)=0'

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

function normalizeAccountOpeningBalance(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value)
  if (!Number.isFinite(parsed)) return 0
  return roundCurrency(parsed)
}

function normalizeDateInput(value: unknown, fallback = new Date().toISOString().slice(0, 10)): string {
  const text = String(value ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback
}

function accountTransactionBalanceExpression(): string {
  return `
    CASE
      WHEN t.type = 'transfer' AND t.transfer_account_id = a.id THEN t.amount
      WHEN t.type = 'transfer' AND t.account_id = a.id THEN -t.amount
      WHEN t.type = 'income' THEN t.amount
      WHEN t.type = 'savings' AND a.type = 'savings' THEN t.amount
      ELSE -t.amount
    END
  `
}

function scaleTransactionSplits(transactionId: number): void {
  const database = getDatabase()
  const transaction = database.prepare('SELECT amount FROM transactions WHERE id=?').get(transactionId) as { amount: number } | undefined
  const splits = database.prepare('SELECT id,amount FROM transaction_splits WHERE transaction_id=? ORDER BY id').all(transactionId) as Array<{ id: number; amount: number }>
  if (!transaction || splits.length === 0) return
  const currentTotal = splits.reduce((sum, split) => sum + split.amount, 0)
  if (currentTotal <= 0 || Math.abs(currentTotal - transaction.amount) <= 0.01) return
  let allocated = 0
  const update = database.prepare('UPDATE transaction_splits SET amount=? WHERE id=?')
  splits.forEach((split, index) => {
    const amount = index === splits.length - 1
      ? roundCurrency(transaction.amount - allocated)
      : roundCurrency(transaction.amount * (split.amount / currentTotal))
    allocated += amount
    update.run(amount, split.id)
  })
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
    const transactionBalance = accountTransactionBalanceExpression()
    return db()
      .prepare(
        `SELECT a.*,
         COALESCE(a.opening_balance, 0) + COALESCE(SUM(${transactionBalance}), 0) as balance,
         COALESCE(SUM(${transactionBalance}), 0) as activity_balance,
         COALESCE(SUM(CASE WHEN t.type = 'income' AND t.account_id = a.id THEN t.amount ELSE 0 END), 0) as income_total,
         COALESCE(SUM(CASE WHEN t.type = 'expense' AND t.account_id = a.id THEN t.amount ELSE 0 END), 0) as expense_total,
         COALESCE(SUM(CASE WHEN t.type = 'savings' AND t.account_id = a.id THEN t.amount ELSE 0 END), 0) as savings_total,
         COUNT(t.id) as transaction_count
         FROM accounts a
         LEFT JOIN transactions t ON t.account_id = a.id OR (t.type = 'transfer' AND t.transfer_account_id = a.id)
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
    const openingBalance = normalizeAccountOpeningBalance(account.openingBalance ?? account.opening_balance)
    const result = db()
      .prepare('INSERT INTO accounts (name, type, currency, opening_balance, is_archived) VALUES (?, ?, ?, ?, 0)')
      .run(name, type, currency, openingBalance)
    return { id: Number(result.lastInsertRowid) }
  })

  ipcMain.handle('accounts:update', (_, id: number, account) => {
    const name = String(account.name ?? '').trim()
    if (!name) throw new Error('Account name is required')
    const type = ['checking', 'savings', 'cash', 'other'].includes(account.type) ? account.type : 'checking'
    const currency = ['SEK', 'EUR', 'USD'].includes(account.currency) ? account.currency : 'SEK'
    const openingBalance = normalizeAccountOpeningBalance(account.openingBalance ?? account.opening_balance)
    db()
      .prepare('UPDATE accounts SET name = ?, type = ?, currency = ?, opening_balance = ? WHERE id = ?')
      .run(name, type, currency, openingBalance, id)
    return true
  })

  ipcMain.handle('accounts:archive', (_, id: number) => {
    const database = db()
    const activeCount = database.prepare('SELECT COUNT(*) as count FROM accounts WHERE is_archived = 0').get() as { count: number }
    if (activeCount.count <= 1) throw new Error('At least one active account is required')
    database.prepare('UPDATE accounts SET is_archived = 1 WHERE id = ?').run(id)
    return true
  })

  ipcMain.handle('accounts:explainBalance', (_, id: number) => {
    const account = db().prepare('SELECT id, name, opening_balance FROM accounts WHERE id = ?').get(id) as
      | { id: number; name: string; opening_balance: number }
      | undefined
    if (!account) return null
    const transactionBalance = accountTransactionBalanceExpression()
    const totals = db()
      .prepare(
         `SELECT
           COALESCE(SUM(${transactionBalance}), 0) as activity,
           COALESCE(SUM(CASE WHEN t.type = 'income' AND t.account_id = ? THEN t.amount ELSE 0 END), 0) as income,
           COALESCE(SUM(CASE WHEN t.type = 'expense' AND t.account_id = ? THEN t.amount ELSE 0 END), 0) as expenses,
           COALESCE(SUM(CASE WHEN t.type = 'savings' AND t.account_id = ? THEN t.amount ELSE 0 END), 0) as savings,
           COALESCE(SUM(CASE WHEN t.type = 'transfer' AND t.account_id = ? THEN -t.amount WHEN t.type = 'transfer' AND t.transfer_account_id = ? THEN t.amount ELSE 0 END), 0) as transfers
         FROM accounts a
         LEFT JOIN transactions t ON t.account_id = a.id OR (t.type = 'transfer' AND t.transfer_account_id = a.id)
         WHERE a.id = ?`
      )
      .get(id, id, id, id, id, id) as {
        activity: number
        income: number
        expenses: number
        savings: number
        transfers: number
      }
    const transactions = db()
      .prepare(
        `SELECT t.id, t.description, t.amount, t.type, t.date, t.account_id, t.transfer_account_id,
                c.name as category_name
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.account_id = ? OR (t.type = 'transfer' AND t.transfer_account_id = ?)
         ORDER BY t.date DESC, t.id DESC
         LIMIT 50`
      )
      .all(id, id)
    return {
      account,
      openingBalance: account.opening_balance ?? 0,
      activityBalance: totals.activity,
      balance: (account.opening_balance ?? 0) + totals.activity,
      totals,
      transactions
    }
  })

  ipcMain.handle('scheduler:getConfig', () => getSchedulerConfig())

  ipcMain.handle('scheduler:setConfig', (_, config) => {
    setSchedulerConfig(config)
    return true
  })

  ipcMain.handle('privacy:auditState', async () => {
    const backupRow = db().prepare("SELECT value FROM settings WHERE key = 'lastDbBackup'").get() as
      | { value: string }
      | undefined
    const warningRow = db().prepare('SELECT COUNT(*) as count FROM integrity_warnings').get() as { count: number }
    return {
      appDataPath: app.getPath('appData'),
      databasePath: getDbPath(),
      databaseReady: isDatabaseInitialized(),
      apiKeyPresent: await hasApiKey(),
      lastBackup: backupRow ? JSON.parse(backupRow.value) : null,
      integrityWarningCount: warningRow.count
    }
  })

  ipcMain.handle('rules:list', () => {
    return db()
      .prepare('SELECT r.*, c.name as category_name FROM categorization_rules r LEFT JOIN categories c ON r.category_id = c.id ORDER BY r.priority ASC, r.id ASC')
      .all()
  })

  ipcMain.handle('rules:create', (_, rule: {
    pattern?: string
    categoryId: number
    priority?: number
    applyFutureOnly?: boolean
    conditions?: RuleNode
  }) => {
    const conditions = rule.conditions ?? legacyRuleNode(rule.pattern ?? '')
    const pattern = String(rule.pattern ?? '').trim() || 'Advanced rule'
    const priority = normalizePositiveInteger(rule.priority ?? 100, 100)
    const r = db()
      .prepare(
        `INSERT INTO categorization_rules (pattern, category_id, priority, apply_future_only, conditions_json)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(pattern, rule.categoryId, priority, rule.applyFutureOnly ? 1 : 0, JSON.stringify(conditions))
    return { id: Number(r.lastInsertRowid) }
  })

  ipcMain.handle('rules:delete', (_, id: number) => {
    db().prepare('DELETE FROM categorization_rules WHERE id = ?').run(id)
    return true
  })

  ipcMain.handle('rules:apply', () => {
    const txs = db().prepare(
      "SELECT id, description, amount, type, category_id FROM transactions"
    ).all() as { id: number; description: string; amount: number; type: string; category_id: number | null }[]
    const updated: number[] = []
    for (const tx of txs) {
      const categoryId = matchingRuleCategoryId(tx, { includeFutureOnly: false }, db())
      if (categoryId && categoryId !== tx.category_id) {
        db().prepare('UPDATE transactions SET category_id = ? WHERE id = ?').run(categoryId, tx.id)
        updated.push(tx.id)
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
    const previous = previousYearMonth(year, month)
    return db()
      .prepare(
        `SELECT c.id as category_id, c.name, c.icon, c.color, c.is_fixed,
         COALESCE(be.amount, c.budget_amount, 0) as base_amount,
         CASE WHEN COALESCE(br.enabled,0)=1 THEN MAX(0,
           COALESCE(pbe.amount, c.budget_amount, 0) - COALESCE((
             SELECT SUM(tca.amount) FROM transaction_category_amounts tca
             WHERE tca.category_id=c.id AND tca.type='expense'
               AND strftime('%Y',tca.date)=? AND strftime('%m',tca.date)=?
           ),0)) ELSE 0 END as rollover,
         COALESCE(be.amount, c.budget_amount, 0) + CASE WHEN COALESCE(br.enabled,0)=1 THEN MAX(0,
           COALESCE(pbe.amount, c.budget_amount, 0) - COALESCE((
             SELECT SUM(tca.amount) FROM transaction_category_amounts tca
             WHERE tca.category_id=c.id AND tca.type='expense'
               AND strftime('%Y',tca.date)=? AND strftime('%m',tca.date)=?
           ),0)) ELSE 0 END as amount,
         COALESCE((SELECT SUM(tca.amount) FROM transaction_category_amounts tca
           WHERE tca.category_id=c.id AND tca.type='expense'
             AND strftime('%Y',tca.date)=? AND strftime('%m',tca.date)=?),0) as spent,
         COALESCE(br.enabled,0) as rollover_enabled, be.notes, be.id as entry_id
         FROM categories c
         LEFT JOIN budget_entries be ON be.category_id = c.id AND be.year = ? AND be.month = ?
         LEFT JOIN budget_entries pbe ON pbe.category_id = c.id AND pbe.year = ? AND pbe.month = ?
         LEFT JOIN budget_rollover br ON br.category_id=c.id
         ORDER BY c.sort_order, c.name`
      )
      .all(String(previous.year), String(previous.month).padStart(2, '0'), String(previous.year), String(previous.month).padStart(2, '0'), String(year), String(month).padStart(2, '0'), year, month, previous.year, previous.month)
  })
  ipcMain.handle('budget:categoryDetail', (_, categoryId: number, year: number, month: number) => {
    const ym = String(month).padStart(2, '0')
    const prevMonth = month === 1 ? 12 : month - 1
    const prevYear = month === 1 ? year - 1 : year
    const prevYm = String(prevMonth).padStart(2, '0')

    const history = db()
      .prepare(
        `SELECT CAST(strftime('%m', tca.date) AS INTEGER) as month,
         COALESCE(SUM(CASE WHEN tca.type='income' THEN -tca.amount ELSE tca.amount END), 0) as spent
         FROM transaction_category_amounts tca
         WHERE tca.category_id = ? AND tca.type IN ('expense','income','transfer') AND strftime('%Y', tca.date) = ?
         GROUP BY month ORDER BY month`
      )
      .all(categoryId, String(year)) as { month: number; spent: number }[]

    const currentSpent = db()
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN type='income' THEN -amount ELSE amount END), 0) as v FROM transaction_category_amounts
         WHERE category_id = ? AND type IN ('expense','income','transfer') AND strftime('%Y', date) = ? AND strftime('%m', date) = ?`
      )
      .get(categoryId, String(year), ym) as { v: number }

    const prevSpent = db()
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN type='income' THEN -amount ELSE amount END), 0) as v FROM transaction_category_amounts
         WHERE category_id = ? AND type IN ('expense','income','transfer') AND strftime('%Y', date) = ? AND strftime('%m', date) = ?`
      )
      .get(categoryId, String(prevYear), prevYm) as { v: number }

    const momChange =
      prevSpent.v > 0 ? ((currentSpent.v - prevSpent.v) / prevSpent.v) * 100 : currentSpent.v > 0 ? 100 : 0

    const ytdAvg = db()
      .prepare(
        `SELECT COALESCE(AVG(monthly), 0) as avg FROM (
           SELECT SUM(CASE WHEN type='income' THEN -amount ELSE amount END) as monthly FROM transaction_category_amounts
           WHERE category_id = ? AND type IN ('expense','income','transfer') AND strftime('%Y', date) = ?
           GROUP BY strftime('%m', date)
         )`
      )
      .get(categoryId, String(year)) as { avg: number }

    const prevYearSpent = db()
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN type='income' THEN -amount ELSE amount END), 0) as v FROM transaction_category_amounts
         WHERE category_id = ? AND type IN ('expense','income','transfer') AND strftime('%Y', date) = ?`
      )
      .get(categoryId, String(year - 1)) as { v: number }

    const transactions = db()
      .prepare(
        `SELECT t.*, c.name as category_name FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         WHERE (t.category_id = ? OR EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id=t.id AND s.category_id=?))
           AND strftime('%Y', t.date) = ? AND strftime('%m', t.date) = ?
         ORDER BY t.date DESC`
      )
      .all(categoryId, categoryId, String(year), ym)

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
    assertYearMonthOpen(Number(data.year), Number(data.month))
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
    let sql = `SELECT t.*,
               COALESCE((SELECT group_concat(sc.name, ' + ') FROM transaction_splits ts JOIN categories sc ON sc.id=ts.category_id WHERE ts.transaction_id=t.id), c.name) as category_name,
               EXISTS(SELECT 1 FROM transaction_splits ts WHERE ts.transaction_id=t.id) as has_splits,
               c.icon as category_icon, c.color as category_color,
               m.name as member_name, a.name as account_name, a.type as account_type, a.currency as account_currency,
               ta.name as transfer_account_name
               FROM transactions t
               LEFT JOIN categories c ON t.category_id = c.id
               LEFT JOIN household_members m ON t.member_id = m.id
               LEFT JOIN accounts a ON t.account_id = a.id
               LEFT JOIN accounts ta ON t.transfer_account_id = ta.id`
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

  ipcMain.handle('transactions:summary', (_, filters?: Record<string, unknown>) => {
    const { sql: whereSql, params } = buildTransactionWhere(filters)
    const row = db()
      .prepare(
        `SELECT
           COUNT(*) as count,
           COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income,
           COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expenses,
           COALESCE(SUM(CASE WHEN type = 'savings' THEN amount ELSE 0 END), 0) as savings,
           COALESCE(SUM(CASE WHEN type = 'transfer' AND transfer_account_id IS NOT NULL THEN amount ELSE 0 END), 0) as internal_transfers,
           COALESCE(SUM(CASE WHEN type = 'transfer' AND transfer_account_id IS NULL THEN amount ELSE 0 END), 0) as external_transfers,
           COALESCE(SUM(CASE
             WHEN type = 'income' THEN amount
             WHEN type = 'transfer' AND transfer_account_id IS NOT NULL THEN 0
             ELSE -amount
           END), 0) as net
         FROM transactions t${whereSql}`
      )
      .get(...params) as {
        count: number
        income: number
        expenses: number
        savings: number
        internal_transfers: number
        external_transfers: number
        net: number
      }
    return row
  })

  ipcMain.handle('transactions:uncategorized', (_, year?: number, month?: number) => {
    const params: unknown[] = []
    let where = "WHERE t.category_id IS NULL AND t.type = 'expense' AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id=t.id)"
    if (year) {
      where += " AND strftime('%Y', t.date) = ?"
      params.push(String(year))
    }
    if (month) {
      where += " AND strftime('%m', t.date) = ?"
      params.push(String(month).padStart(2, '0'))
    }
    return db()
      .prepare(
        `SELECT t.id, t.description, t.amount, t.date, t.type, a.name as account_name
         FROM transactions t
         LEFT JOIN accounts a ON t.account_id = a.id
         ${where}
         ORDER BY t.date DESC, t.id DESC
         LIMIT 25`
      )
      .all(...params)
  })

  ipcMain.handle('transactions:categorize', (_, id: number, categoryId: number) => {
    recategorizeTransaction(id, categoryId)
    return true
  })

  // Use command pattern for transaction creation
  ipcMain.handle('transactions:create', (_, tx) => {
    if (!Number.isFinite(tx.amount) || tx.amount <= 0) {
      throw new Error('Amount must be a positive number')
    }
    if (!tx.description?.trim()) {
      throw new Error('Description is required')
    }
    const splitRows = Array.isArray(tx.splits) ? tx.splits : []
    // Auto-assign savings category for savings transactions
    let savingsCategoryId: number | null = null
    if (tx.type === 'savings') {
      savingsCategoryId = getSavingsCategoryId(db())
    }
    const ruleCategoryId = !tx.categoryId && splitRows.length === 0
      ? matchingRuleCategoryId({ description: tx.description, amount: tx.amount, type: tx.type, category_id: null }, { includeFutureOnly: false }, db())
      : null
    const assignedCategoryId = splitRows.length > 0
      ? null
      : (tx.type === 'savings' && !tx.categoryId ? savingsCategoryId : (tx.categoryId ?? ruleCategoryId ?? null))
    const accountId = normalizeAccountId(tx.accountId)
    const transferAccountId = tx.type === 'transfer' && tx.transferAccountId
      ? normalizeAccountId(tx.transferAccountId)
      : null

    if (tx.type === 'transfer' && transferAccountId !== null && transferAccountId === accountId) {
      throw new Error('Transfer destination must be different from source account')
    }

    if (!tx.allowDuplicate) {
      const duplicates = findDuplicateTransactions({
        description: tx.description,
        amount: tx.amount,
        type: tx.type,
        account_id: accountId,
        transfer_account_id: transferAccountId,
        date: tx.date
      })
      if (duplicates.length > 0) {
        return { duplicate: true, matches: duplicates }
      }
    }

    if (splitRows.length > 0) {
      const splitTotal = roundCurrency(splitRows.reduce((sum: number, split: { amount: number }) => sum + Number(split.amount || 0), 0))
      if (Math.abs(splitTotal - roundCurrency(tx.amount)) > 0.01) throw new Error(`Split amounts must total ${roundCurrency(tx.amount)}.`)
      if (new Set(splitRows.map((split: { categoryId: number }) => split.categoryId)).size !== splitRows.length) {
        throw new Error('Each split must use a different category.')
      }
      const categoryExists = db().prepare('SELECT 1 FROM categories WHERE id = ?')
      for (const split of splitRows) {
        if (!Number.isInteger(split.categoryId) || !Number.isFinite(split.amount) || split.amount <= 0 || !categoryExists.get(split.categoryId)) {
          throw new Error('Each split must use a valid category and a positive amount.')
        }
      }
    }

    const result = createTransaction({
      description: tx.description,
      amount: tx.amount,
      type: tx.type,
      account_id: accountId,
      transfer_account_id: transferAccountId,
      category_id: assignedCategoryId,
      date: tx.date,
      is_recurring: tx.isRecurring ?? false,
      is_unnecessary: tx.isUnnecessary ?? false,
      member_id: tx.memberId ?? null,
      notes: tx.notes ?? null
    })
    const alias = db().prepare(`SELECT merchant_name FROM merchant_aliases WHERE lower(?) LIKE '%' || lower(pattern) || '%' ORDER BY length(pattern) DESC LIMIT 1`)
      .get(tx.description) as { merchant_name: string } | undefined
    if (alias) db().prepare('UPDATE transactions SET merchant_name=? WHERE id=?').run(alias.merchant_name, result.id)
    if (splitRows.length > 0) {
      const insertSplit = db().prepare('INSERT INTO transaction_splits (transaction_id,category_id,amount) VALUES (?,?,?)')
      for (const split of splitRows) insertSplit.run(result.id, split.categoryId, roundCurrency(split.amount))
    }
    
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
      } else if (tx.type !== 'transfer' || transferAccountId === null) {
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
    const current = db().prepare('SELECT is_recurring, description, amount, date, type, account_id, transfer_account_id, notes FROM transactions WHERE id = ?').get(id) as
      | { is_recurring: number; description: string; amount: number; date: string; type: string; account_id: number | null; transfer_account_id: number | null; notes: string | null }
      | undefined

    if (!current) {
      throw new Error(`Transaction ${id} not found`)
    }

    const nextType = tx.type ?? current.type
    const nextAccountId = tx.accountId !== undefined ? normalizeAccountId(tx.accountId) : current.account_id
    const nextTransferAccountId = nextType === 'transfer'
      ? tx.transferAccountId !== undefined
        ? (tx.transferAccountId ? normalizeAccountId(tx.transferAccountId) : null)
        : current.transfer_account_id
      : null

    if (nextType === 'transfer' && nextTransferAccountId !== null && nextTransferAccountId === nextAccountId) {
      throw new Error('Transfer destination must be different from source account')
    }

    const result = updateTransaction({
      id,
      description: tx.description,
      amount: tx.amount !== undefined && nextType === 'income' ? Math.abs(tx.amount) : tx.amount,
      type: tx.type,
      account_id: tx.accountId !== undefined ? nextAccountId : undefined,
      transfer_account_id: tx.transferAccountId !== undefined || nextType !== current.type ? nextTransferAccountId : undefined,
      category_id: tx.categoryId !== undefined ? tx.categoryId : undefined,
      date: tx.date,
      is_recurring: tx.isRecurring ? true : tx.isRecurring === false ? false : undefined,
      is_unnecessary: tx.isUnnecessary,
      member_id: tx.memberId !== undefined ? tx.memberId : undefined,
      notes: tx.notes !== undefined ? tx.notes : undefined
    })
    if (tx.amount !== undefined) scaleTransactionSplits(id)
    if (tx.description !== undefined) {
      const alias = db().prepare(`SELECT merchant_name FROM merchant_aliases WHERE lower(?) LIKE '%' || lower(pattern) || '%' ORDER BY length(pattern) DESC LIMIT 1`)
        .get(tx.description) as { merchant_name: string } | undefined
      db().prepare('UPDATE transactions SET merchant_name=? WHERE id=?').run(alias?.merchant_name ?? null, id)
    }

    const description = tx.description ?? current.description
    const amount = tx.amount !== undefined && nextType === 'income' ? Math.abs(tx.amount) : (tx.amount ?? current.amount)
    const date = tx.date ?? current.date
    const accountId = nextAccountId
    const notes = tx.notes !== undefined ? tx.notes : current.notes

    const incomeSourceMatch = typeof notes === 'string' ? notes.match(/^income_source:(\d+)$/) : null
    if (incomeSourceMatch && nextType === 'income') {
      const sourceId = Number(incomeSourceMatch[1])
      const normalizedAmount = Math.abs(Number(amount) || 0)
      const { year, month } = parseDateToLocalYearMonth(date)
      db()
        .prepare('UPDATE income_sources SET name = ?, amount = ?, account_id = ?, next_billing_date = ? WHERE id = ?')
        .run(description.replace(/\s+\(one-time\)$/, ''), normalizedAmount, accountId, date, sourceId)
      db().prepare('DELETE FROM income_entries WHERE source_id = ?').run(sourceId)
      db()
        .prepare('INSERT OR IGNORE INTO income_entries (source_id, year, month, amount, is_irregular) VALUES (?, ?, ?, ?, 1)')
        .run(sourceId, year, month, normalizedAmount)
    }

    if (tx.isRecurring !== undefined) {
      const wasRecurring = current.is_recurring === 1
      const isRecurring = tx.isRecurring
      const txType = nextType

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
        } else if (txType !== 'transfer' || nextTransferAccountId === null) {
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
        } else if (txType !== 'transfer' || nextTransferAccountId === null) {
          db().prepare(
            `UPDATE subscriptions SET name = ?, amount = ?, account_id = ? WHERE transaction_id = ?`
          ).run(description, amount, accountId, id)
        } else {
          db().prepare('DELETE FROM subscriptions WHERE transaction_id = ?').run(id)
          db().prepare('DELETE FROM savings_sources WHERE transaction_id = ?').run(id)
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

  ipcMain.handle('transactions:csvAnalyze', (_, csv: string, mapping: CsvMapping & { accountId?: number }) => {
    const rows = importTransactionsFromCsv(csv, mapping)
    const accountId = normalizeAccountId(mapping?.accountId)
    const analyzed = rows.map((row) => {
      const type = row.type === 'income' || row.type === 'transfer' ? row.type : 'expense'
      const categoryId = matchingRuleCategoryId(row, { includeFutureOnly: true }, db())
      return {
        ...row,
        type,
        categoryId,
        duplicate: findDuplicateTransactions({
          description: row.description, amount: row.amount, type,
          account_id: accountId, transfer_account_id: null, date: row.date
        }).length > 0
      }
    })
    return { rows: analyzed.slice(0, 100), total: analyzed.length, duplicates: analyzed.filter((row) => row.duplicate).length }
  })

  // CSV export
  ipcMain.handle('transactions:exportCsv', () => {
    const rows = db()
      .prepare(
        `SELECT t.description, t.amount, t.date, t.type,
                COALESCE((SELECT group_concat(sc.name, ' + ') FROM transaction_splits ts JOIN categories sc ON sc.id=ts.category_id WHERE ts.transaction_id=t.id), c.name) as category_name,
                a.name as account_name, ta.name as transfer_account_name
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         LEFT JOIN accounts a ON t.account_id = a.id
         LEFT JOIN accounts ta ON t.transfer_account_id = ta.id
         ORDER BY t.date DESC, t.id DESC`
      )
      .all() as TransactionRow[]
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
    const categorizedRows = rows.map((row) => ({
      ...row,
      category_id: matchingRuleCategoryId(row, { includeFutureOnly: true }, db())
    }))
    return importTransactionsFromCsvWithEvents(categorizedRows, normalizeAccountId(mapping?.accountId))
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
      const categorizedRows = rows.map((row) => ({
        ...row,
        category_id: matchingRuleCategoryId(row, { includeFutureOnly: true }, db())
      }))
      return importTransactionsFromCsvWithEvents(categorizedRows, normalizeAccountId(accountId))
    }
    return { imported: 0 }
  })

  // New transaction event sourcing handlers
  ipcMain.handle('transactions:history', (_, id: number) => {
    return getTransactionHistory(id)
  })
  
  ipcMain.handle('transactions:undo', (_, id: number) => {
    const result = undoLastChange(id)
    if (result) scaleTransactionSplits(id)
    return result
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

    return goals.map((g) => ({
      ...g,
      current_amount: g.type === 'debt' ? g.current_amount : (getGoalCurrentAmount(db(), g.type) ?? g.current_amount)
    }))
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
      if (cat.goal_type === 'debt') continue
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
    const targetAmount = Math.max(0, Number(goal.targetAmount) || 0)
    const currentAmount = Math.max(0, Math.min(targetAmount, Number(goal.currentAmount) || 0))
    const hmac = signGoal({
      name: goal.name,
      type: goal.type,
      target_amount: targetAmount,
      current_amount: currentAmount,
      target_date: goal.targetDate ?? null
    })
    const r = db()
      .prepare(
        `INSERT INTO goals (name, type, target_amount, current_amount, target_date, interest_rate, monthly_payment, creditor, notes, hmac)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        goal.name,
        goal.type,
        targetAmount,
        currentAmount,
        goal.targetDate,
        goal.interestRate,
        goal.monthlyPayment,
        goal.creditor?.trim() || null,
        goal.notes,
        hmac
      )
    return { id: Number(r.lastInsertRowid) }
  })
  ipcMain.handle('goals:update', (_, id: number, goal) => {
    const existing = db().prepare('SELECT type FROM goals WHERE id=?').get(id) as { type: string } | undefined
    if (!existing) throw new Error('Goal not found')
    const trackedPayments = db().prepare('SELECT COALESCE(SUM(amount),0) AS total FROM debt_payments WHERE goal_id=?').get(id) as { total: number }
    if (trackedPayments.total > 0 && goal.type !== 'debt') throw new Error('A debt with payment history cannot be changed to another goal type.')
    const targetAmount = Math.max(trackedPayments.total, Number(goal.targetAmount) || 0)
    const currentAmount = Math.max(trackedPayments.total, Math.min(targetAmount, Number(goal.currentAmount) || 0))
    const hmac = signGoal({
      name: goal.name,
      type: goal.type,
      target_amount: targetAmount,
      current_amount: currentAmount,
      target_date: goal.targetDate ?? null
    })
    db()
      .prepare(
        `UPDATE goals SET name=?, type=?, target_amount=?, current_amount=?, target_date=?,
         interest_rate=?, monthly_payment=?, creditor=?, notes=?, hmac=? WHERE id=?`
      )
      .run(
        goal.name,
        goal.type,
        targetAmount,
        currentAmount,
        goal.targetDate,
        goal.interestRate,
        goal.monthlyPayment,
        goal.creditor?.trim() || null,
        goal.notes,
        hmac,
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

  ipcMain.handle('subscriptions:dueWarnings', (_, minDays = 3, maxDays = 7) => {
    const rows: Array<{
      type: 'subscription' | 'income' | 'savings'
      id: number
      name: string
      amount: number
      date: string | null
      days: number
    }> = []
    const subscriptions = db()
      .prepare("SELECT id, name, amount, next_billing_date FROM subscriptions WHERE COALESCE(on_hold, 0) = 0 AND next_billing_date IS NOT NULL")
      .all() as Array<{ id: number; name: string; amount: number; next_billing_date: string }>
    for (const sub of subscriptions) {
      const days = daysUntil(sub.next_billing_date)
      if (days !== null && days >= minDays && days <= maxDays) {
        rows.push({ type: 'subscription', id: sub.id, name: sub.name, amount: sub.amount, date: sub.next_billing_date, days })
      }
    }
    const income = db()
      .prepare("SELECT id, name, amount, next_billing_date FROM income_sources WHERE COALESCE(is_recurring, 1) = 1 AND next_billing_date IS NOT NULL")
      .all() as Array<{ id: number; name: string; amount: number; next_billing_date: string }>
    for (const source of income) {
      const days = daysUntil(source.next_billing_date)
      if (days !== null && days >= minDays && days <= maxDays) {
        rows.push({ type: 'income', id: source.id, name: source.name, amount: source.amount, date: source.next_billing_date, days })
      }
    }
    const savings = db()
      .prepare(
        `SELECT s.id, s.description, s.amount, COALESCE(t.date, substr(s.created_at, 1, 10)) as anchor_date
         FROM savings_sources s
         LEFT JOIN transactions t ON s.transaction_id = t.id
         WHERE COALESCE(s.is_recurring, 1) = 1`
      )
      .all() as Array<{ id: number; description: string; amount: number; anchor_date: string | null }>
    for (const source of savings) {
      let date = source.anchor_date ?? isoDate(getNow())
      for (let i = 0; i < 24 && date < isoDate(getNow()); i++) {
        date = addMonths(date, 1)
      }
      const days = daysUntil(date)
      if (days !== null && days >= minDays && days <= maxDays) {
        rows.push({ type: 'savings', id: source.id, name: source.description, amount: source.amount, date, days })
      }
    }
    return rows.sort((a, b) => a.days - b.days)
  })

  ipcMain.handle('subscriptions:priceHistory', (_, id: number) => {
    const sub = db().prepare('SELECT id, name, amount, next_billing_date, transaction_id FROM subscriptions WHERE id = ?').get(id) as
      | { id: number; name: string; amount: number; next_billing_date: string | null; transaction_id: number | null }
      | undefined
    if (!sub) return []
    const history = db()
      .prepare(
        `SELECT id, amount, date, 'transaction' as source
         FROM transactions
         WHERE (notes = ? OR id = ?) AND type = 'expense'
         ORDER BY date ASC, id ASC`
      )
      .all(`subscription:${id}`, sub.transaction_id ?? -1) as Array<{ id: number; amount: number; date: string; source: string }>
    return [
      ...history,
      {
        id: sub.id,
        amount: sub.amount,
        date: sub.next_billing_date ?? isoDate(getNow()),
        source: 'current'
      }
    ]
  })

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
          const noteMarker = `subscription:${id}`
          const existing = db().prepare(
            `SELECT id FROM transactions
             WHERE notes = ? AND type = 'expense'
             ORDER BY date DESC, id DESC
             LIMIT 1`
          ).get(noteMarker) as { id: number } | undefined

          if (existing) {
            updateTransaction({ id: existing.id, is_recurring: true })
            db().prepare('UPDATE subscriptions SET transaction_id = ? WHERE id = ?').run(existing.id, id)
            return { success: true, transactionId: existing.id }
          }

          const result = createTransaction({
            description: sub.name as string,
            amount: sub.amount as number,
            type: 'expense',
            account_id: normalizeAccountId(sub.account_id),
            date: (sub.next_billing_date as string | null) || new Date().toISOString().slice(0, 10),
            is_recurring: true,
            notes: noteMarker
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
    const amount = Math.abs(Number.isFinite(src.amount) ? src.amount : 0)
    const accountId = normalizeAccountId(src.accountId)
    const nextBillingDate = normalizeDateInput(src.nextBillingDate ?? src.date)
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
        'INSERT INTO income_sources (name, amount, is_gross, gross_or_net, is_recurring, frequency, color, account_id, next_billing_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
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
        nextBillingDate
      )
    const newId = Number(r.lastInsertRowid)
    // Non-recurring: create entry + transaction scoped to current month only
    if (isRecurring === 0) {
      const { year, month } = parseDateToLocalYearMonth(nextBillingDate)
      db().prepare(
        'INSERT OR IGNORE INTO income_entries (source_id, year, month, amount, is_irregular) VALUES (?, ?, ?, ?, 1)'
      ).run(newId, year, month, amount)
      createTransaction({
        description: src.name + ' (one-time)',
        amount,
        type: 'income',
        account_id: accountId,
        date: nextBillingDate,
        is_recurring: false,
        notes: 'income_source:' + newId
      })
    }
    return { id: newId }
  })
  ipcMain.handle('income:updateSource', (_, src) => {
    const amount = Math.abs(Number.isFinite(src.amount) ? src.amount : 0)
    const accountId = normalizeAccountId(src.accountId)
    const nextBillingDate = normalizeDateInput(src.nextBillingDate ?? src.date)
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
        'UPDATE income_sources SET name = ?, amount = ?, is_gross = ?, gross_or_net = ?, is_recurring = ?, frequency = ?, color = ?, account_id = ?, next_billing_date = ? WHERE id = ?'
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
        nextBillingDate,
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
            date: nextBillingDate
          })
        }
      }
    }
    // Non-recurring: ensure entry + transaction exist (covers toggle from recurring)
    if (isRecurring === 0) {
      const { year, month } = parseDateToLocalYearMonth(nextBillingDate)
      db().prepare('DELETE FROM income_entries WHERE source_id = ?').run(src.id)
      db().prepare(
        'INSERT OR IGNORE INTO income_entries (source_id, year, month, amount, is_irregular) VALUES (?, ?, ?, ?, 1)'
      ).run(src.id, year, month, amount)
      const existingTx = db().prepare("SELECT id FROM transactions WHERE notes = ?").get('income_source:' + src.id) as { id: number } | undefined
      if (existingTx) {
        updateTransaction({
          id: existingTx.id,
          description: src.name + ' (one-time)',
          amount,
          type: 'income',
          account_id: accountId,
          date: nextBillingDate,
          notes: 'income_source:' + src.id
        })
      } else {
        createTransaction({
          description: src.name + ' (one-time)',
          amount,
          type: 'income',
          account_id: accountId,
          date: nextBillingDate,
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
    assertYearMonthOpen(Number(data.year), Number(data.month))
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
        `SELECT c.name, c.color, SUM(tca.amount) as total
         FROM transaction_category_amounts tca JOIN categories c ON tca.category_id = c.id
         WHERE tca.type = 'expense' AND strftime('%Y', tca.date) = ?
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
         LEFT JOIN transaction_category_amounts t ON t.category_id = c.id AND t.type = 'expense'
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
         JOIN transaction_category_amounts t ON t.category_id = c.id AND t.type = 'expense' AND strftime('%Y', t.date) = ?
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
         FROM transaction_category_amounts
         WHERE category_id = ? AND type IN ('expense', 'savings')
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

  ipcMain.handle('transactions:duplicates', (_, tx) => {
    if (!Number.isFinite(tx.amount) || tx.amount <= 0 || !tx.description?.trim()) {
      return []
    }
    return findDuplicateTransactions({
      description: tx.description,
      amount: tx.amount,
      type: tx.type,
      account_id: normalizeAccountId(tx.accountId),
      date: tx.date
    })
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
        `SELECT t.id, COALESCE(t.merchant_name,t.description) AS description, tca.amount, tca.date, t.is_recurring
         FROM transaction_category_amounts tca
         JOIN transactions t ON t.id=tca.transaction_id
         WHERE tca.category_id = ?
           AND tca.type IN ('expense', 'savings')
           AND tca.date >= ?
           AND tca.date < ?
         ORDER BY tca.date DESC, t.id DESC`
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

    function getAccountsNetWorth(): number {
      const transactionBalance = accountTransactionBalanceExpression()
      const accountsTotal = db()
        .prepare(
          `SELECT COALESCE(SUM(balance), 0) as v FROM (
             SELECT COALESCE(a.opening_balance, 0) + COALESCE(SUM(${transactionBalance}), 0) as balance
             FROM accounts a
             LEFT JOIN transactions t ON t.account_id = a.id OR (t.type = 'transfer' AND t.transfer_account_id = a.id)
             WHERE a.is_archived = 0
             GROUP BY a.id
           )`
        )
        .get() as { v: number }
      return accountsTotal.v
    }

    const wealth = db().prepare('SELECT * FROM wealth_snapshots ORDER BY date DESC LIMIT 1').get() as
      | Record<string, number>
      | undefined
    const accountsNetWorth = getAccountsNetWorth()
    const liveInvestments = db().prepare(`
      SELECT
        (SELECT COALESCE(SUM(current_value),0) FROM investment_holdings) +
        (SELECT COALESCE(SUM(current_value),0) FROM investments) AS total
    `).get() as { total: number }
    const trackedDebts = db().prepare(`
      SELECT COALESCE(SUM(MAX(0,target_amount-current_amount)),0) AS total
      FROM goals WHERE type='debt'
    `).get() as { total: number }
    const investmentValue = liveInvestments.total !== 0 ? liveInvestments.total : (wealth?.assets_investments || 0)
    const netWorth =
      accountsNetWorth +
      investmentValue +
      (wealth?.assets_property || 0) -
      trackedDebts.total -
      (wealth?.liabilities_credit || 0)

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

    const goals = rawGoals.map((g) => ({ ...g, current_amount: getGoalCurrentAmount(db(), g.type) ?? g.current_amount }))

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

  ipcMain.handle('dashboard:monthlyReview', (_, year: number, month: number) => {
    const current = { year, month }
    const previous = previousYearMonth(year, month)
    const currentYm = { y: String(current.year), m: String(current.month).padStart(2, '0') }
    const previousYm = { y: String(previous.year), m: String(previous.month).padStart(2, '0') }

    function monthTotals(ym: { y: string; m: string }): { income: number; expenses: number; savings: number; count: number } {
      return db()
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0) as income,
             COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) as expenses,
             COALESCE(SUM(CASE WHEN type='savings' THEN amount ELSE 0 END), 0) as savings,
             COUNT(*) as count
           FROM transactions
           WHERE strftime('%Y', date)=? AND strftime('%m', date)=?`
        )
        .get(ym.y, ym.m) as { income: number; expenses: number; savings: number; count: number }
    }

    const currentTotals = monthTotals(currentYm)
    const previousTotals = monthTotals(previousYm)
    const increasedSubscriptions = db()
      .prepare(
        `SELECT s.id, s.name, s.amount, t.amount as previous_amount, s.next_billing_date
         FROM subscriptions s
         JOIN transactions t ON t.notes = 'subscription:' || s.id OR t.id = s.transaction_id
         WHERE t.type = 'expense' AND t.amount < s.amount
         GROUP BY s.id
         ORDER BY s.amount - t.amount DESC
         LIMIT 5`
      )
      .all()
    const newRecurring = db()
      .prepare(
        `SELECT id, name, amount, next_billing_date
         FROM subscriptions
         WHERE strftime('%Y', COALESCE(next_billing_date, date('now')))=?
           AND strftime('%m', COALESCE(next_billing_date, date('now')))=?
           AND transaction_id IS NULL
         ORDER BY amount DESC
         LIMIT 5`
      )
      .all(currentYm.y, currentYm.m)
    const unusualTransactions = db()
      .prepare(
        `SELECT t.id, t.description, t.amount, t.date, t.type, c.name as category_name
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         WHERE strftime('%Y', t.date)=? AND strftime('%m', t.date)=?
           AND t.type IN ('expense', 'savings')
           AND t.amount >= (
             SELECT COALESCE(AVG(amount) * 2, 0)
             FROM transactions
             WHERE type = t.type AND date < t.date AND date >= date(t.date, '-6 months')
           )
         ORDER BY t.amount DESC
         LIMIT 6`
      )
      .all(currentYm.y, currentYm.m)

    return {
      currentTotals,
      previousTotals,
      deltas: {
        income: roundCurrency(currentTotals.income - previousTotals.income),
        expenses: roundCurrency(currentTotals.expenses - previousTotals.expenses),
        savings: roundCurrency(currentTotals.savings - previousTotals.savings),
        count: currentTotals.count - previousTotals.count
      },
      increasedSubscriptions,
      newRecurring,
      unusualTransactions
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
    const result = await dialog.showSaveDialog(win!, {
      title: 'Export database',
      defaultPath: `budget-backup-${Date.now()}.db`,
      filters: [{ name: 'SQLite', extensions: ['db'] }]
    })
    if (!result.canceled && result.filePath) {
      await db().backup(result.filePath)
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
      for (const table of DATA_TABLES) database.prepare(`DELETE FROM ${table}`).run()
      database.prepare('DELETE FROM settings').run()
      database
        .prepare(`DELETE FROM sqlite_sequence WHERE name IN (${DATA_TABLES.map(() => '?').join(',')})`)
        .run(...DATA_TABLES)
      database
        .prepare("INSERT INTO accounts (name, type, currency, is_archived) VALUES ('Main', 'checking', 'SEK', 0)")
        .run()
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

  ipcMain.handle('data:auditFixScan', () => {
    const brokenSubscriptions = db()
      .prepare(
        `SELECT s.id, s.name, s.transaction_id
         FROM subscriptions s
         LEFT JOIN transactions t ON s.transaction_id = t.id
         WHERE s.transaction_id IS NOT NULL AND t.id IS NULL`
      )
      .all()
    const brokenSavings = db()
      .prepare(
        `SELECT s.id, s.description as name, s.transaction_id
         FROM savings_sources s
         LEFT JOIN transactions t ON s.transaction_id = t.id
         WHERE s.transaction_id IS NOT NULL AND t.id IS NULL`
      )
      .all()
    const duplicateSubscriptionTransactions = db()
      .prepare(
        `SELECT notes, COUNT(*) as count, GROUP_CONCAT(id) as ids, MIN(date) as first_date, MAX(date) as last_date
         FROM transactions
         WHERE notes LIKE 'subscription:%' AND type = 'expense'
         GROUP BY notes, date
         HAVING COUNT(*) > 1`
      )
      .all()
    const missingAccountTransactions = db()
      .prepare(
        `SELECT t.id, t.description, t.account_id
         FROM transactions t
         LEFT JOIN accounts a ON t.account_id = a.id
         WHERE t.account_id IS NULL OR a.id IS NULL`
      )
      .all()
    const recurringArchivedAccounts = db()
      .prepare(
        `SELECT 'subscription' as type, s.id, s.name, s.account_id
         FROM subscriptions s JOIN accounts a ON s.account_id = a.id
         WHERE a.is_archived = 1
         UNION ALL
         SELECT 'income' as type, i.id, i.name, i.account_id
         FROM income_sources i JOIN accounts a ON i.account_id = a.id
         WHERE a.is_archived = 1
         UNION ALL
         SELECT 'savings' as type, ss.id, ss.description as name, ss.account_id
         FROM savings_sources ss JOIN accounts a ON ss.account_id = a.id
         WHERE a.is_archived = 1`
      )
      .all()
    return {
      brokenLinks: [...brokenSubscriptions, ...brokenSavings],
      duplicateSubscriptionTransactions,
      missingAccountTransactions,
      recurringArchivedAccounts
    }
  })

  ipcMain.handle('data:auditFixApply', () => {
    const database = db()
    const tx = database.transaction(() => {
      const primaryAccountId = getPrimaryAccountId()
      const brokenSubscriptions = database
        .prepare(
          `SELECT s.id
           FROM subscriptions s
           LEFT JOIN transactions t ON s.transaction_id = t.id
           WHERE s.transaction_id IS NOT NULL AND t.id IS NULL`
        )
        .all() as Array<{ id: number }>
      for (const sub of brokenSubscriptions) {
        database.prepare('UPDATE subscriptions SET transaction_id = NULL WHERE id = ?').run(sub.id)
      }

      const brokenSavings = database
        .prepare(
          `SELECT s.id
           FROM savings_sources s
           LEFT JOIN transactions t ON s.transaction_id = t.id
           WHERE s.transaction_id IS NOT NULL AND t.id IS NULL`
        )
        .all() as Array<{ id: number }>
      for (const source of brokenSavings) {
        database.prepare('UPDATE savings_sources SET transaction_id = NULL WHERE id = ?').run(source.id)
      }

      const duplicates = database
        .prepare(
          `SELECT notes, date, GROUP_CONCAT(id) as ids
           FROM transactions
           WHERE notes LIKE 'subscription:%' AND type = 'expense'
           GROUP BY notes, date
           HAVING COUNT(*) > 1`
        )
        .all() as Array<{ notes: string; date: string; ids: string }>
      let removedDuplicates = 0
      for (const group of duplicates) {
        const ids = group.ids.split(',').map((value) => Number(value)).filter((value) => Number.isInteger(value)).sort((a, b) => a - b)
        for (const duplicateId of ids.slice(1)) {
          deleteTransaction(duplicateId)
          removedDuplicates++
        }
      }

      const missingAccounts = database
        .prepare(
          `SELECT t.id
           FROM transactions t
           LEFT JOIN accounts a ON t.account_id = a.id
           WHERE t.account_id IS NULL OR a.id IS NULL`
        )
        .all() as Array<{ id: number }>
      for (const row of missingAccounts) {
        updateTransaction({ id: row.id, account_id: primaryAccountId })
      }

      database.prepare('UPDATE subscriptions SET account_id = ? WHERE account_id IN (SELECT id FROM accounts WHERE is_archived = 1) OR account_id IS NULL').run(primaryAccountId)
      database.prepare('UPDATE income_sources SET account_id = ? WHERE account_id IN (SELECT id FROM accounts WHERE is_archived = 1) OR account_id IS NULL').run(primaryAccountId)
      database.prepare('UPDATE savings_sources SET account_id = ? WHERE account_id IN (SELECT id FROM accounts WHERE is_archived = 1) OR account_id IS NULL').run(primaryAccountId)

      return {
        clearedBrokenLinks: brokenSubscriptions.length + brokenSavings.length,
        removedDuplicates,
        reassignedTransactions: missingAccounts.length
      }
    })
    const result = tx()
    const attachmentPath = join(app.getPath('appData'), 'BudgetApp', 'attachments')
    if (existsSync(attachmentPath)) rmSync(attachmentPath, { recursive: true, force: true })
    return result
  })

  ipcMain.handle('ai:saveInsight', (_, content: string, year: number, month: number) => {
    db()
      .prepare('INSERT INTO ai_insights (type, content, year, month) VALUES (?, ?, ?, ?)')
      .run('dashboard', content, year, month)
    return true
  })

  ipcMain.handle('reports:taxReviewExport', async (_, year: number, categoryIds: number[] = []) => {
    const database = db()
    const selectedCategoryIds = categoryIds
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0)
    const yearStart = `${year}-01-01`
    const nextYearStart = `${year + 1}-01-01`
    const rows: unknown[][] = []

    const subscriptions = database
      .prepare(
        `SELECT s.name, s.amount, s.frequency, s.next_billing_date, s.website_url, s.on_hold, a.name as account_name
         FROM subscriptions s
         LEFT JOIN accounts a ON s.account_id = a.id
         WHERE s.tax_deductible = 1
         ORDER BY s.name COLLATE NOCASE`
      )
      .all() as Array<{
        name: string
        amount: number
        frequency: string
        next_billing_date: string | null
        website_url: string | null
        on_hold: number
        account_name: string | null
      }>
    for (const sub of subscriptions) {
      rows.push([
        'Tax-deductible subscription',
        sub.next_billing_date ?? '',
        sub.name,
        roundCurrency(monthlyAmount(sub.amount, sub.frequency) * 12),
        'subscription',
        '',
        sub.account_name ?? '',
        sub.frequency,
        sub.on_hold ? 'On hold' : sub.website_url ?? ''
      ])
    }

    const incomeAndSavings = database
      .prepare(
        `SELECT t.date, t.description, t.amount, t.type, c.name as category_name, a.name as account_name, t.notes
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         LEFT JOIN accounts a ON t.account_id = a.id
         WHERE t.date >= ? AND t.date < ?
           AND t.type IN ('income', 'savings')
         ORDER BY t.date ASC, t.id ASC`
      )
      .all(yearStart, nextYearStart) as Array<{
        date: string
        description: string
        amount: number
        type: string
        category_name: string | null
        account_name: string | null
        notes: string | null
      }>
    for (const tx of incomeAndSavings) {
      rows.push([
        tx.type === 'income' ? 'Income' : 'Savings',
        tx.date,
        tx.description,
        roundCurrency(tx.amount),
        tx.type,
        tx.category_name ?? '',
        tx.account_name ?? '',
        'transaction',
        tx.notes ?? ''
      ])
    }

    if (selectedCategoryIds.length > 0) {
      const placeholders = selectedCategoryIds.map(() => '?').join(',')
      const selectedExpenses = database
        .prepare(
          `SELECT t.date, t.description, t.amount, t.type, c.name as category_name, a.name as account_name, t.notes
           FROM transactions t
           LEFT JOIN categories c ON t.category_id = c.id
           LEFT JOIN accounts a ON t.account_id = a.id
           WHERE t.date >= ? AND t.date < ?
             AND t.type = 'expense'
             AND t.category_id IN (${placeholders})
           ORDER BY c.name COLLATE NOCASE, t.date ASC, t.id ASC`
        )
        .all(yearStart, nextYearStart, ...selectedCategoryIds) as Array<{
          date: string
          description: string
          amount: number
          type: string
          category_name: string | null
          account_name: string | null
          notes: string | null
        }>
      for (const tx of selectedExpenses) {
        rows.push([
          'Selected category expense',
          tx.date,
          tx.description,
          roundCurrency(tx.amount),
          tx.type,
          tx.category_name ?? '',
          tx.account_name ?? '',
          'transaction',
          tx.notes ?? ''
        ])
      }
    }

    const csv = toCsv(
      ['Section', 'Date', 'Description', 'Amount', 'Type', 'Category', 'Account', 'Source', 'Notes'],
      rows
    )
    const win = getWindow()
    const result = await dialog.showSaveDialog(win!, {
      title: 'Export tax/accountant review CSV',
      defaultPath: `tax-review-${year}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (!result.canceled && result.filePath) {
      writeFileSync(result.filePath, csv, 'utf8')
      return { filePath: result.filePath, rowCount: rows.length }
    }
    return { filePath: null, rowCount: rows.length }
  })

  ipcMain.handle('tax:list', (_, year: number) => {
    return db()
      .prepare(
        `SELECT id, year, month, income_gross, income_net_actual, supposed_net_income, updated_at
         FROM tax_estimates
         WHERE year = ?
         ORDER BY month ASC`
      )
      .all(year)
  })

  ipcMain.handle('tax:getYearSettings', (_, year: number) => {
    const parsedYear = Math.floor(Number(year))
    const normalizedYear = Number.isFinite(parsedYear) ? parsedYear : new Date().getFullYear()
    const row = db()
      .prepare(
        `SELECT year, expected_yearly_tax_owed, updated_at
         FROM tax_year_settings
         WHERE year = ?`
      )
      .get(normalizedYear) as
      | { year: number; expected_yearly_tax_owed: number | null; updated_at: string }
      | undefined

    return row ?? { year: normalizedYear, expected_yearly_tax_owed: null, updated_at: null }
  })

  ipcMain.handle('tax:setYearSettings', (_, data: { year: number; expectedYearlyTaxOwed?: number | null }) => {
    const parsedYear = Math.floor(Number(data.year))
    const year = Number.isFinite(parsedYear) ? parsedYear : new Date().getFullYear()
    const expected = data.expectedYearlyTaxOwed
    const normalizedExpected = expected == null || !Number.isFinite(Number(expected))
      ? null
      : roundCurrency(Number(expected))

    db()
      .prepare(
        `INSERT INTO tax_year_settings (year, expected_yearly_tax_owed, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(year) DO UPDATE SET
           expected_yearly_tax_owed = excluded.expected_yearly_tax_owed,
           updated_at = datetime('now')`
      )
      .run(year, normalizedExpected)
    return { year, expected_yearly_tax_owed: normalizedExpected }
  })

  ipcMain.handle('tax:setEntry', (_, data: {
    year: number
    month: number
    incomeGross: number
    incomeNetActual: number
    supposedNetIncome: number
  }) => {
    assertYearMonthOpen(Number(data.year), Number(data.month))
    const month = normalizePositiveInteger(data.month, 1, 12)
    const parsedYear = Math.floor(Number(data.year))
    const year = Number.isFinite(parsedYear) ? parsedYear : new Date().getFullYear()
    const incomeGross = roundCurrency(Number(data.incomeGross) || 0)
    const incomeNetActual = roundCurrency(Number(data.incomeNetActual) || 0)
    const supposedNetIncome = roundCurrency(Number(data.supposedNetIncome) || 0)
    db()
      .prepare(
        `INSERT INTO tax_estimates (year, month, income_gross, income_net_actual, supposed_net_income, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(year, month) DO UPDATE SET
           income_gross = excluded.income_gross,
           income_net_actual = excluded.income_net_actual,
           supposed_net_income = excluded.supposed_net_income,
           updated_at = datetime('now')`
      )
      .run(year, month, incomeGross, incomeNetActual, supposedNetIncome)
    return true
  })

  ipcMain.handle('tax:deleteEntry', (_, year: number, month: number) => {
    assertYearMonthOpen(year, month)
    const normalizedMonth = normalizePositiveInteger(month, 1, 12)
    const parsedYear = Math.floor(Number(year))
    const normalizedYear = Number.isFinite(parsedYear) ? parsedYear : new Date().getFullYear()
    db()
      .prepare('DELETE FROM tax_estimates WHERE year = ? AND month = ?')
      .run(normalizedYear, normalizedMonth)
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
      const trackedDebts = db().prepare(`
        SELECT COALESCE(SUM(MAX(0,target_amount-current_amount)),0) AS total
        FROM goals WHERE type='debt'
      `).get() as { total: number }
      netWorth =
        (wealth.assets_savings || 0) +
        (wealth.assets_investments || 0) +
        (wealth.assets_property || 0) -
        trackedDebts.total -
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

  ipcMain.handle('goals:forecast', () => {
    const goals = db().prepare('SELECT * FROM goals ORDER BY id').all() as Array<{
      id: number
      type: string
      target_amount: number
      current_amount: number
      monthly_payment?: number | null
    }>
    const savingsMonthly = db()
      .prepare("SELECT COALESCE(SUM(amount), 0) as v FROM savings_sources WHERE COALESCE(is_recurring, 1) = 1")
      .get() as { v: number }
    return goals.map((goal) => {
      const current = getGoalCurrentAmount(db(), goal.type) ?? goal.current_amount ?? 0
      const remaining = Math.max(0, goal.target_amount - current)
      const monthly = goal.monthly_payment && goal.monthly_payment > 0 ? goal.monthly_payment : savingsMonthly.v
      if (remaining <= 0) {
        return { id: goal.id, projectedDate: isoDate(getNow()), months: 0, monthlyAmount: monthly, status: 'complete' }
      }
      if (!monthly || monthly <= 0) {
        return { id: goal.id, projectedDate: null, months: null, monthlyAmount: monthly, status: 'needs_monthly_amount' }
      }
      const months = Math.ceil(remaining / monthly)
      return {
        id: goal.id,
        projectedDate: addMonths(isoDate(getNow()), months),
        months,
        monthlyAmount: roundCurrency(monthly),
        status: 'projected'
      }
    })
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

  registerFinancialToolsHandlers(getWindow)
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

function getGoalCurrentAmount(database: ReturnType<typeof getDatabase>, goalType: string): number | null {
  if (goalType === 'investment') {
    const total = database
      .prepare('SELECT COALESCE(SUM(current_value), 0) as v FROM investment_holdings')
      .get() as { v: number }
    return total.v
  }

  if (goalType === 'savings' || goalType === 'emergency' || goalType === 'fire') {
    const totalSaved = database
      .prepare(`SELECT COALESCE(SUM(amount), 0) as v FROM transactions WHERE type='savings'`)
      .get() as { v: number }
    return totalSaved.v
  }

  return null
}

function exportAllTables(): Record<string, unknown[]> {
  const database = getDatabase()
  const dump: Record<string, unknown[]> = {}
  for (const table of BACKUP_TABLES) {
    dump[table] = database.prepare(`SELECT * FROM ${table}`).all()
  }
  return dump
}

function importAllTables(data: Record<string, unknown[]>): void {
  const database = getDatabase()
  const tx = database.transaction((txData: Record<string, unknown[]>) => {
    for (const table of BACKUP_TABLES) {
      database.prepare(`DELETE FROM ${table}`).run()
    }

    const insertOrder = [
      'settings',
      'household_members',
      'accounts',
      'categories',
      'goals',
      'debt_payments',
      'wealth_snapshots',
      'investments',
      'investment_holdings',
      'transactions',
      'transaction_events',
      'transaction_splits',
      'tags',
      'transaction_tags',
      'transaction_links',
      'shared_expenses',
      'transaction_attachments',
      'account_reconciliations',
      'budget_entries',
      'budget_rollover',
      'categorization_rules',
      'saved_filters',
      'merchant_aliases',
      'closed_months',
      'subscriptions',
      'savings_sources',
      'income_sources',
      'income_entries',
      'tax_estimates',
      'tax_year_settings',
      'monthly_mood',
      'ai_insights',
      'currency_cache',
      'integrity_warnings'
    ] as const

    for (const table of insertOrder) {
      const rows = txData[table]
      if (!rows?.length) continue
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
