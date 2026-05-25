import { getDatabase } from '../database'

export function buildFinancialContext(): string {
  const db = getDatabase()
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  const profile = db.prepare("SELECT value FROM settings WHERE key = 'profile'").get() as
    | { value: string }
    | undefined
  const profileData = profile ? JSON.parse(profile.value) : {}

  const monthSpending = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
       WHERE type = 'expense' AND strftime('%Y', date) = ? AND strftime('%m', date) = ?`
    )
    .get(String(year), String(month).padStart(2, '0')) as { total: number }

  const monthIncome = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
       WHERE type = 'income' AND strftime('%Y', date) = ? AND strftime('%m', date) = ?`
    )
    .get(String(year), String(month).padStart(2, '0')) as { total: number }

  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all()
  const goals = db.prepare('SELECT * FROM goals').all()
  const subscriptions = db.prepare('SELECT * FROM subscriptions').all()
  const recentTx = db
    .prepare(
      `SELECT t.*, c.name as category_name FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       ORDER BY t.date DESC LIMIT 30`
    )
    .all()

  const wealth = db
    .prepare('SELECT * FROM wealth_snapshots ORDER BY date DESC LIMIT 1')
    .get()

  const budgetTotal = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total FROM budget_entries WHERE year = ? AND month = ?`
    )
    .get(year, month) as { total: number }

  const categorySpend = db
    .prepare(
      `SELECT c.name, COALESCE(SUM(t.amount), 0) as spent
       FROM categories c
       LEFT JOIN transactions t ON t.category_id = c.id
         AND t.type = 'expense'
         AND strftime('%Y', t.date) = ?
         AND strftime('%m', t.date) = ?
       GROUP BY c.id`
    )
    .all(String(year), String(month).padStart(2, '0'))

  return JSON.stringify(
    {
      profile: profileData,
      currentMonth: { year, month, spending: monthSpending.total, income: monthIncome.total },
      budgetTotal: budgetTotal.total,
      categorySpending: categorySpend,
      categories,
      goals,
      subscriptions,
      netWorthSnapshot: wealth,
      recentTransactions: recentTx
    },
    null,
    2
  )
}
