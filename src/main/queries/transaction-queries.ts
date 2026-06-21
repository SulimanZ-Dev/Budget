import { getDatabase } from '../database-encrypted'
import { verifyTransaction } from '../crypto/integrity'

/**
 * Query: Get all transactions with optional filters
 */
export interface TransactionFilters {
  year?: number
  month?: number
  categoryId?: number
  type?: 'expense' | 'income' | 'savings' | 'transfer'
  flagged?: boolean
  search?: string
  recurring?: boolean
}

export function getTransactions(filters?: TransactionFilters) {
  const db = getDatabase()
  
  let sql = `
    SELECT t.*, 
           c.name as category_name, 
           c.icon as category_icon, 
           c.color as category_color,
           m.name as member_name 
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN household_members m ON t.member_id = m.id 
    WHERE 1=1
  `
  
  const params: any[] = []
  
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
  } else if (filters?.recurring === false) {
    sql += ' AND t.is_recurring = 0'
  }
  
  sql += ' ORDER BY t.date DESC, t.id DESC'
  
  return db.prepare(sql).all(...params)
}

/**
 * Query: Get a single transaction by ID
 */
export function getTransactionById(id: number) {
  const db = getDatabase()
  
  return db.prepare(`
    SELECT t.*, 
           c.name as category_name, 
           c.icon as category_icon, 
           c.color as category_color,
           m.name as member_name 
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN household_members m ON t.member_id = m.id 
    WHERE t.id = ?
  `).get(id)
}

/**
 * Query: Get monthly summary statistics
 */
export function getMonthlySummary(year: number, month: number) {
  const db = getDatabase()
  const ym = String(month).padStart(2, '0')
  
  const expenses = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM transactions
    WHERE type = 'expense' 
      AND strftime('%Y', date) = ? 
      AND strftime('%m', date) = ?
  `).get(String(year), ym) as { total: number }
  
  const income = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM transactions
    WHERE type = 'income' 
      AND strftime('%Y', date) = ? 
      AND strftime('%m', date) = ?
  `).get(String(year), ym) as { total: number }
  
  const savings = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM transactions
    WHERE type = 'savings' 
      AND strftime('%Y', date) = ? 
      AND strftime('%m', date) = ?
  `).get(String(year), ym) as { total: number }
  
  const unnecessary = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM transactions
    WHERE type = 'expense' 
      AND is_unnecessary = 1
      AND strftime('%Y', date) = ? 
      AND strftime('%m', date) = ?
  `).get(String(year), ym) as { total: number }
  
  return {
    expenses: expenses.total,
    income: income.total,
    savings: savings.total,
    unnecessary: unnecessary.total,
    netIncome: income.total - expenses.total - savings.total
  }
}

/**
 * Query: Get spending by category for a given period
 */
export function getCategorySpending(year: number, month?: number) {
  const db = getDatabase()
  
  let sql = `
    SELECT 
      c.id,
      c.name,
      c.icon,
      c.color,
      COALESCE(SUM(t.amount), 0) as spent,
      COUNT(t.id) as transaction_count
    FROM categories c
    LEFT JOIN transactions t ON t.category_id = c.id 
      AND t.type = 'expense'
      AND strftime('%Y', t.date) = ?
  `
  
  const params: any[] = [String(year)]
  
  if (month !== undefined) {
    sql += ` AND strftime('%m', t.date) = ?`
    params.push(String(month).padStart(2, '0'))
  }
  
  sql += `
    GROUP BY c.id, c.name, c.icon, c.color
    ORDER BY spent DESC
  `
  
  return db.prepare(sql).all(...params)
}

/**
 * Query: Get transactions by date range
 */
export function getTransactionsByDateRange(startDate: string, endDate: string) {
  const db = getDatabase()
  
  return db.prepare(`
    SELECT t.*, 
           c.name as category_name, 
           c.icon as category_icon, 
           c.color as category_color,
           m.name as member_name 
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN household_members m ON t.member_id = m.id 
    WHERE t.date BETWEEN ? AND ?
    ORDER BY t.date DESC, t.id DESC
  `).all(startDate, endDate)
}

/**
 * Query: Search transactions
 */
export function searchTransactions(query: string, limit: number = 50) {
  const db = getDatabase()
  
  return db.prepare(`
    SELECT t.*, 
           c.name as category_name, 
           c.icon as category_icon, 
           c.color as category_color,
           m.name as member_name 
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN household_members m ON t.member_id = m.id 
    WHERE t.description LIKE ? OR t.notes LIKE ?
    ORDER BY t.date DESC, t.id DESC
    LIMIT ?
  `).all(`%${query}%`, `%${query}%`, limit)
}

/**
 * Query: Get spending trends over time
 */
export function getSpendingTrends(year: number) {
  const db = getDatabase()
  
  return db.prepare(`
    SELECT 
      CAST(strftime('%m', date) AS INTEGER) as month,
      type,
      COALESCE(SUM(amount), 0) as total
    FROM transactions
    WHERE strftime('%Y', date) = ?
    GROUP BY month, type
    ORDER BY month, type
  `).all(String(year))
}

/**
 * Query: Get top spending categories
 */
export function getTopSpendingCategories(year: number, month: number, limit: number = 5) {
  const db = getDatabase()
  const ym = String(month).padStart(2, '0')
  
  return db.prepare(`
    SELECT 
      c.id,
      c.name,
      c.icon,
      c.color,
      COALESCE(SUM(t.amount), 0) as spent
    FROM categories c
    INNER JOIN transactions t ON t.category_id = c.id
    WHERE t.type = 'expense'
      AND strftime('%Y', t.date) = ?
      AND strftime('%m', t.date) = ?
    GROUP BY c.id, c.name, c.icon, c.color
    ORDER BY spent DESC
    LIMIT ?
  `).all(String(year), ym, limit)
}

/**
 * Query: Get recent transactions
 */
export function getRecentTransactions(limit: number = 10) {
  const db = getDatabase()
  
  return db.prepare(`
    SELECT t.*, 
           c.name as category_name, 
           c.icon as category_icon, 
           c.color as category_color,
           m.name as member_name 
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN household_members m ON t.member_id = m.id 
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT ?
  `).all(limit)
}

/**
 * Query: Get transaction count by type
 */
export function getTransactionCountByType(year: number, month?: number) {
  const db = getDatabase()
  
  let sql = `
    SELECT type, COUNT(*) as count
    FROM transactions
    WHERE strftime('%Y', date) = ?
  `
  
  const params: any[] = [String(year)]
  
  if (month !== undefined) {
    sql += ` AND strftime('%m', date) = ?`
    params.push(String(month).padStart(2, '0'))
  }
  
  sql += ' GROUP BY type'
  
  return db.prepare(sql).all(...params)
}

/**
 * Query: Verify transaction integrity
 */
export function verifyTransactionIntegrity(id: number): boolean {
  const db = getDatabase()
  
  const transaction = db.prepare(`
    SELECT * FROM transactions WHERE id = ?
  `).get(id) as any
  
  if (!transaction) {
    return false
  }
  
  return verifyTransaction(transaction)
}

/**
 * Query: Get all transactions with failed integrity checks
 */
export function getTransactionsWithIntegrityIssues() {
  const db = getDatabase()
  
  const transactions = db.prepare('SELECT * FROM transactions').all() as any[]
  
  return transactions.filter(tx => !verifyTransaction(tx))
}

/**
 * Query: Get year-over-year comparison
 */
/**
 * Query: Get transaction event history
 */
export function getTransactionHistory(id: number) {
  const db = getDatabase()
  const { getTransactionHistory: getHistory } = require('../events/event-store')
  return getHistory(db, id)
}

/**
 * Query: Get year-over-year comparison
 */
export function getYearOverYearComparison(currentYear: number, previousYear: number) {
  const db = getDatabase()
  
  const currentYearData = db.prepare(`
    SELECT 
      type,
      COALESCE(SUM(amount), 0) as total
    FROM transactions
    WHERE strftime('%Y', date) = ?
    GROUP BY type
  `).all(String(currentYear))
  
  const previousYearData = db.prepare(`
    SELECT 
      type,
      COALESCE(SUM(amount), 0) as total
    FROM transactions
    WHERE strftime('%Y', date) = ?
    GROUP BY type
  `).all(String(previousYear))
  
  return {
    current: currentYearData,
    previous: previousYearData
  }
}

// Made with Bob
