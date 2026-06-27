import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { copyFileSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getDatabase, getDbPath } from '../database-encrypted'
import { fetchExchangeRates, getCachedRates } from '../services/currency'
import { saveApiKey, getApiKey, deleteApiKey, hasApiKey } from '../services/keychain'
import {
  chatWithAI,
  suggestCategory,
  generateInsight,
  generateWeeklyTip
} from '../services/ai'
import { checkBudgetAlerts } from '../services/budget-alerts'
import {
  importTransactionsFromCsv,
  parseCsvPreview,
  guessColumnIndexes,
  type CsvMapping
} from '../services/csv-import'
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
  importTransactionsFromCsvWithEvents
} from '../commands/transaction-commands'
import {
  getTransactions,
  getTransactionHistory,
  verifyTransactionIntegrity
} from '../queries/transaction-queries'

type GetWindow = () => BrowserWindow | null

export function registerIpcHandlers(getWindow: GetWindow): void {
  const db = () => getDatabase()

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
         COALESCE(SUM(t.amount), 0) as spent
         FROM transactions t
         WHERE t.category_id = ? AND t.type = 'expense' AND strftime('%Y', t.date) = ?
         GROUP BY month ORDER BY month`
      )
      .all(categoryId, String(year)) as { month: number; spent: number }[]

    const currentSpent = db()
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as v FROM transactions
         WHERE category_id = ? AND type = 'expense' AND strftime('%Y', date) = ? AND strftime('%m', date) = ?`
      )
      .get(categoryId, String(year), ym) as { v: number }

    const prevSpent = db()
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as v FROM transactions
         WHERE category_id = ? AND type = 'expense' AND strftime('%Y', date) = ? AND strftime('%m', date) = ?`
      )
      .get(categoryId, String(prevYear), prevYm) as { v: number }

    const momChange =
      prevSpent.v > 0 ? ((currentSpent.v - prevSpent.v) / prevSpent.v) * 100 : currentSpent.v > 0 ? 100 : 0

    const ytdAvg = db()
      .prepare(
        `SELECT COALESCE(AVG(monthly), 0) as avg FROM (
           SELECT SUM(amount) as monthly FROM transactions
           WHERE category_id = ? AND type = 'expense' AND strftime('%Y', date) = ?
           GROUP BY strftime('%m', date)
         )`
      )
      .get(categoryId, String(year)) as { avg: number }

    const prevYearSpent = db()
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as v FROM transactions
         WHERE category_id = ? AND type = 'expense' AND strftime('%Y', date) = ?`
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
    // Compute HMAC signature
    const hmac = signBudgetEntry({
      category_id: data.categoryId,
      year: data.year,
      month: data.month,
      amount: data.amount
    })
    
    db()
      .prepare(
        `INSERT INTO budget_entries (category_id, year, month, amount, notes, hmac)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(category_id, year, month) DO UPDATE SET amount=excluded.amount, notes=excluded.notes, hmac=excluded.hmac`
      )
      .run(data.categoryId, data.year, data.month, data.amount, data.notes ?? null, hmac)
    return true
  })

  // Transactions
  ipcMain.handle('transactions:list', (_, filters?: Record<string, unknown>) => {
    let sql = `SELECT t.*, c.name as category_name, c.icon as category_icon, c.color as category_color,
               m.name as member_name FROM transactions t
               LEFT JOIN categories c ON t.category_id = c.id
               LEFT JOIN household_members m ON t.member_id = m.id WHERE 1=1`
    const params: unknown[] = []
    if (filters?.year) {
      sql += ` AND strftime('%Y', t.date) = ?`
      params.push(String(filters.year))
    }
    if (filters?.month) {
      sql += ` AND strftime('%m', t.date) = ?`
      params.push(String(filters.month).padStart(2, '0'))
    }
    if (filters?.categoryId) {
      sql += ' AND t.category_id = ?'
      params.push(filters.categoryId)
    }
    if (filters?.type) {
      sql += ' AND t.type = ?'
      params.push(filters.type)
    }
    if (filters?.flagged) {
      sql += ' AND t.is_unnecessary = 1'
    }
    if (filters?.search) {
      sql += ' AND t.description LIKE ?'
      params.push(`%${filters.search}%`)
    }
    if (filters?.recurring === true) {
      sql += ' AND t.is_recurring = 1'
    }
    if (filters?.recurring === false) {
      sql += ' AND t.is_recurring = 0'
    }
    sql += ' ORDER BY t.date DESC, t.id DESC'
    return db().prepare(sql).all(...params)
  })
  // Use command pattern for transaction creation
  ipcMain.handle('transactions:create', (_, tx) => {
    const result = createTransaction({
      description: tx.description,
      amount: tx.amount,
      type: tx.type,
      category_id: tx.categoryId ?? null,
      date: tx.date,
      is_recurring: tx.isRecurring ?? false,
      is_unnecessary: tx.isUnnecessary ?? false,
      member_id: tx.memberId ?? null,
      notes: tx.notes ?? null
    })
    
    updateSpendingStreak(tx.date)
    const txDate = new Date(tx.date)
    if (tx.categoryId) {
      checkBudgetAlerts(tx.categoryId, txDate.getFullYear(), txDate.getMonth() + 1)
    }
    return result
  })
  // Use command pattern for transaction updates
  ipcMain.handle('transactions:update', (_, id: number, tx) => {
    const result = updateTransaction({
      id,
      description: tx.description,
      amount: tx.amount,
      type: tx.type,
      category_id: tx.categoryId ?? null,
      date: tx.date,
      is_recurring: tx.isRecurring ?? false,
      is_unnecessary: tx.isUnnecessary ?? false,
      member_id: tx.memberId ?? null,
      notes: tx.notes ?? null
    })
    
    // Check budget alerts if category changed
    if (tx.categoryId) {
      const d = new Date(tx.date)
      checkBudgetAlerts(tx.categoryId, d.getFullYear(), d.getMonth() + 1)
    }
    return result
  })
  // Use command pattern for transaction deletion
  ipcMain.handle('transactions:delete', (_, id: number) => {
    return deleteTransaction(id)
  })
  // Use command pattern for bulk operations
  ipcMain.handle('transactions:bulk', (_, action: string, ids: number[], data?: unknown) => {
    if (action === 'recategorize' && data) {
      const catId = (data as { categoryId: number }).categoryId
      return bulkRecategorizeTransactions(ids, catId)
    }
    if (action === 'delete') {
      return bulkDeleteTransactions(ids)
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

  // Use command pattern for CSV import
  ipcMain.handle('transactions:importCsv', (_, csv: string, mapping?: CsvMapping) => {
    const preview = parseCsvPreview(csv, 1)
    const map: CsvMapping = mapping ?? {
      ...guessColumnIndexes(preview.headers),
      delimiter: preview.delimiter,
      hasHeader: true
    }
    const rows = importTransactionsFromCsv(csv, map)
    return importTransactionsFromCsvWithEvents(rows)
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
    db().prepare('SELECT * FROM subscriptions ORDER BY amount DESC').all()
  )
  ipcMain.handle('subscriptions:create', (_, sub) => {
    const r = db()
      .prepare(
        `INSERT INTO subscriptions (name, amount, frequency, next_billing_date, website_url, icon, color, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        sub.name,
        sub.amount,
        sub.frequency,
        sub.nextBillingDate,
        sub.websiteUrl,
        sub.icon,
        sub.color,
        sub.notes
      )
    return { id: Number(r.lastInsertRowid) }
  })
  ipcMain.handle('subscriptions:update', (_, id: number, sub) => {
    db()
      .prepare(
        `UPDATE subscriptions SET name=?, amount=?, frequency=?, next_billing_date=?,
         website_url=?, icon=?, color=?, notes=? WHERE id=?`
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
        id
      )
    return true
  })
  ipcMain.handle('subscriptions:delete', (_, id: number) => {
    db().prepare('DELETE FROM subscriptions WHERE id = ?').run(id)
    return true
  })

  // Income
  ipcMain.handle('income:sources', () => db().prepare('SELECT * FROM income_sources').all())
  ipcMain.handle('income:createSource', (_, src) => {
    const amount = Number.isFinite(src.amount) ? src.amount : 0
    const grossOrNet = src.grossOrNet === 'gross' ? 'gross' : src.isGross ? 'gross' : 'net'
    const frequency =
      src.frequency === 'weekly' ||
      src.frequency === 'fortnightly' ||
      src.frequency === 'yearly' ||
      src.frequency === 'monthly'
        ? src.frequency
        : 'monthly'
    const r = db()
      .prepare(
        'INSERT INTO income_sources (name, amount, is_gross, gross_or_net, is_recurring, frequency, color) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        src.name,
        amount,
        grossOrNet === 'gross' ? 1 : 0,
        grossOrNet,
        src.isRecurring !== false ? 1 : 0,
        frequency,
        src.color ?? '#22c55e'
      )
    return { id: Number(r.lastInsertRowid) }
  })
  ipcMain.handle('income:updateSource', (_, src) => {
    const amount = Number.isFinite(src.amount) ? src.amount : 0
    const grossOrNet = src.grossOrNet === 'gross' ? 'gross' : src.isGross ? 'gross' : 'net'
    const frequency =
      src.frequency === 'weekly' ||
      src.frequency === 'fortnightly' ||
      src.frequency === 'yearly' ||
      src.frequency === 'monthly'
        ? src.frequency
        : 'monthly'
    // Fetch old amount before updating — needed to scale per-month entries
    const oldRow = db().prepare('SELECT amount FROM income_sources WHERE id = ?').get(src.id) as { amount: number } | undefined
    const oldAmount = oldRow?.amount ?? amount
    db()
      .prepare(
        'UPDATE income_sources SET name = ?, amount = ?, is_gross = ?, gross_or_net = ?, is_recurring = ?, frequency = ?, color = ? WHERE id = ?'
      )
      .run(
        src.name,
        amount,
        grossOrNet === 'gross' ? 1 : 0,
        grossOrNet,
        src.isRecurring !== false ? 1 : 0,
        frequency,
        src.color ?? '#22c55e',
        src.id
      )
    // Replace all per-month entries with the new base amount
    if (oldAmount > 0 && amount !== oldAmount) {
      db().prepare(
        'UPDATE income_entries SET amount = ? WHERE source_id = ?'
      ).run(amount, src.id)
    }
    return true
  })
  ipcMain.handle('income:deleteSource', (_, id: number) => {
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

  ipcMain.handle('transactions:search', (_, query: string, limit = 20) => {
    return db()
      .prepare(
        `SELECT t.id, t.description, t.amount, t.date, t.type, c.name as category_name
         FROM transactions t LEFT JOIN categories c ON t.category_id = c.id
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

  // Backup
  ipcMain.handle('data:exportDb', async () => {
    const win = getWindow()
    const result = await dialog.showSaveDialog(win!, {
      title: 'Export database',
      defaultPath: `budget-backup-${Date.now()}.db`,
      filters: [{ name: 'SQLite', extensions: ['db'] }]
    })
    if (!result.canceled && result.filePath) {
      copyFileSync(getDbPath(), result.filePath)
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

  ipcMain.handle('data:importJson', async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Import JSON backup',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (!result.canceled && result.filePaths[0]) {
      const data = JSON.parse(readFileSync(result.filePaths[0], 'utf8'))
      importAllTables(data)
      return true
    }
    return false
  })

  ipcMain.handle('data:wipe', () => {
    const tables = [
      'transactions',
      'budget_entries',
      'categories',
      'goals',
      'wealth_snapshots',
      'investments',
      'investment_holdings',
      'subscriptions',
      'income_entries',
      'income_sources',
      'monthly_mood',
      'ai_insights',
      'household_members'
    ]
    for (const t of tables) db().prepare(`DELETE FROM ${t}`).run()
    // Reset onboarding
    db().prepare("DELETE FROM settings WHERE key = 'onboardingComplete'").run()
    db()
      .prepare(
        `INSERT OR REPLACE INTO settings (key, value) VALUES
        ('profile', '{"name":"","currency":"SEK","displayCurrency":"SEK","cpiPercent":2.5,"taxWithheldPercent":30,"theme":"system","year":${new Date().getFullYear()},"autoHideZeroCategories":false,"notificationsEnabled":true,"grossIncomeToggle":false}'),
        ('spendingStreak', '{"current":0,"longest":0,"lastDate":null}')`
      )
      .run()
    return true
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
    const subscriptions = db().prepare('SELECT SUM(amount) as total FROM subscriptions').get() as
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

  ipcMain.handle('print:yearSummary', () => {
    const win = getWindow()
    win?.webContents.print({ silent: false, printBackground: true })
  })
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
    const diff = (new Date(today).getTime() - new Date(last).getTime()) / 86400000
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
      goals.reduce((s, g) => s + Math.min(g.current_amount / g.target_amount, 1), 0) /
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
    'categories',
    'transactions',
    'budget_entries',
    'goals',
    'wealth_snapshots',
    'investments',
    'subscriptions',
    'income_sources',
    'income_entries',
    'monthly_mood',
    'ai_insights'
  ]
  const dump: Record<string, unknown[]> = {}
  for (const t of tables) {
    dump[t] = database.prepare(`SELECT * FROM ${t}`).all()
  }
  return dump
}

function importAllTables(data: Record<string, unknown[]>): void {
  const database = getDatabase()
  const order = [
    'household_members',
    'categories',
    'transactions',
    'budget_entries',
    'goals',
    'wealth_snapshots',
    'investments',
    'subscriptions',
    'income_sources',
    'income_entries',
    'monthly_mood',
    'ai_insights',
    'settings'
  ]
  for (const table of order) {
    const rows = data[table]
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
}
