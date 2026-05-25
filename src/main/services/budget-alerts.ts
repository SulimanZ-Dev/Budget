import { Notification } from 'electron'
import { getDatabase } from '../database'

export function checkBudgetAlerts(
  categoryId: number | null | undefined,
  year: number,
  month: number
): void {
  if (!categoryId) return

  const db = getDatabase()
  const profile = db.prepare("SELECT value FROM settings WHERE key = 'profile'").get() as
    | { value: string }
    | undefined
  const profileData = profile ? JSON.parse(profile.value) : { notificationsEnabled: true }
  if (!profileData.notificationsEnabled) return

  const ym = { y: String(year), m: String(month).padStart(2, '0') }

  const budgeted = db
    .prepare(
      `SELECT COALESCE(be.amount, c.budget_amount, 0) as amount, c.name
       FROM categories c
       LEFT JOIN budget_entries be ON be.category_id = c.id AND be.year = ? AND be.month = ?
       WHERE c.id = ?`
    )
    .get(year, month, categoryId) as { amount: number; name: string } | undefined

  if (!budgeted || budgeted.amount <= 0) return

  const spent = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
       WHERE type = 'expense' AND category_id = ? AND strftime('%Y', date) = ? AND strftime('%m', date) = ?`
    )
    .get(categoryId, ym.y, ym.m) as { total: number }

  const pct = (spent.total / budgeted.amount) * 100
  if (pct >= 80 && pct < 100) {
    if (Notification.isSupported()) {
      new Notification({
        title: 'Budget alert',
        body: `You've used ${pct.toFixed(0)}% of your ${budgeted.name} budget this month.`
      }).show()
    }
  } else if (pct >= 100) {
    if (Notification.isSupported()) {
      new Notification({
        title: 'Budget exceeded',
        body: `${budgeted.name} is over budget (${pct.toFixed(0)}% used).`
      }).show()
    }
  }
}
