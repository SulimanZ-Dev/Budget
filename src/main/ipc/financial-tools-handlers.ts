import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import SqlCipher from 'better-sqlite3-multiple-ciphers'
import { randomUUID } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'
import { getAttachmentStoragePath, getDatabase } from '../database-encrypted'
import { getDEK } from '../crypto/keyManager'
import { signGoal } from '../crypto/integrity'
import { deleteTransaction, restoreTransactionToEvent, updateTransaction } from '../commands/transaction-commands'
import { calculateDebtPayoffPlan } from '../services/debt-payoff'
import { assertMonthOpen } from '../services/month-lock'
import { normalizeDebtPaymentBreakdown } from '../services/debt-payment'

type GetWindow = () => BrowserWindow | null

function round(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00`)
  value.setDate(value.getDate() + days)
  return value.toISOString().slice(0, 10)
}

function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const value = new Date(year, month - 1 + months, 1, 12)
  value.setDate(Math.min(day, new Date(value.getFullYear(), value.getMonth() + 1, 0).getDate()))
  return value.toISOString().slice(0, 10)
}

function advanceDate(date: string, frequency: string): string {
  if (frequency === 'weekly') return addDays(date, 7)
  if (frequency === 'fortnightly') return addDays(date, 14)
  if (frequency === 'yearly' || frequency === 'annual') return addMonths(date, 12)
  return addMonths(date, 1)
}

function monthlyAmount(amount: number, frequency?: string | null): number {
  if (frequency === 'weekly') return amount * 52 / 12
  if (frequency === 'fortnightly') return amount * 26 / 12
  if (frequency === 'yearly' || frequency === 'annual') return amount / 12
  return amount
}

function accountBalanceAt(accountId: number, statementDate: string): number {
  const database = getDatabase()
  const account = database.prepare('SELECT opening_balance, type FROM accounts WHERE id = ?').get(accountId) as
    | { opening_balance: number; type: string }
    | undefined
  if (!account) throw new Error('Account not found')
  const row = database.prepare(`
    SELECT COALESCE(SUM(CASE
      WHEN type = 'transfer' AND transfer_account_id = ? THEN amount
      WHEN type = 'transfer' AND account_id = ? THEN -amount
      WHEN type = 'income' AND account_id = ? THEN amount
      WHEN type = 'savings' AND account_id = ? AND ? = 'savings' THEN amount
      WHEN account_id = ? THEN -amount
      ELSE 0
    END), 0) AS activity
    FROM transactions
    WHERE date <= ? AND (account_id = ? OR transfer_account_id = ?)
  `).get(accountId, accountId, accountId, accountId, account.type, accountId, statementDate, accountId, accountId) as { activity: number }
  return round((account.opening_balance ?? 0) + row.activity)
}

function getAttachmentDir(): string {
  const path = getAttachmentStoragePath()
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
  return path
}

function reportRows(year: number, month?: number): Array<Record<string, unknown>> {
  const params: unknown[] = [String(year)]
  let monthSql = ''
  if (month) {
    monthSql = " AND strftime('%m', t.date) = ?"
    params.push(String(month).padStart(2, '0'))
  }
  return getDatabase().prepare(`
    SELECT t.date, COALESCE(t.merchant_name, t.description) AS description, t.type, t.amount,
           COALESCE((
             SELECT group_concat(sc.name || ' ' || printf('%.2f', ts.amount), '; ')
             FROM transaction_splits ts JOIN categories sc ON sc.id = ts.category_id
             WHERE ts.transaction_id = t.id
           ), c.name) AS category,
           a.name AS account, ta.name AS transfer_account,
           t.reconciled, t.notes
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN accounts a ON a.id = t.account_id
    LEFT JOIN accounts ta ON ta.id = t.transfer_account_id
    WHERE strftime('%Y', t.date) = ?${monthSql}
    ORDER BY t.date, t.id
  `).all(...params) as Array<Record<string, unknown>>
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function buildCsv(rows: Array<Record<string, unknown>>): string {
  const headers = ['date', 'description', 'type', 'amount', 'category', 'account', 'transfer_account', 'reconciled', 'notes']
  return [headers.join(','), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(','))].join('\n') + '\n'
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function registerFinancialToolsHandlers(getWindow: GetWindow): void {
  const db = () => getDatabase()

  ipcMain.handle('transactions:extras', (_, id: number) => {
    const transaction = db().prepare(`
      SELECT id, description, amount, date, type, merchant_name, reconciled, reconciled_at
      FROM transactions WHERE id = ?
    `).get(id)
    if (!transaction) throw new Error('Transaction not found')
    return {
      transaction,
      splits: db().prepare(`
        SELECT s.id, s.category_id, s.amount, c.name AS category_name
        FROM transaction_splits s JOIN categories c ON c.id = s.category_id
        WHERE s.transaction_id = ? ORDER BY s.id
      `).all(id),
      tags: db().prepare(`
        SELECT t.id, t.name, t.color FROM tags t
        JOIN transaction_tags tt ON tt.tag_id = t.id
        WHERE tt.transaction_id = ? ORDER BY t.name
      `).all(id),
      attachments: db().prepare('SELECT * FROM transaction_attachments WHERE transaction_id = ? ORDER BY id').all(id),
      sharedExpenses: db().prepare('SELECT * FROM shared_expenses WHERE transaction_id = ? ORDER BY id').all(id),
      refundLinks: db().prepare(`
        SELECT l.*, COALESCE(t.merchant_name, t.description) AS description, t.amount, t.date, t.type
        FROM transaction_links l
        JOIN transactions t ON t.id = CASE WHEN l.source_transaction_id = ? THEN l.linked_transaction_id ELSE l.source_transaction_id END
        WHERE (l.source_transaction_id = ? OR l.linked_transaction_id = ?) AND l.link_type = 'refund'
      `).all(id, id, id)
    }
  })

  ipcMain.handle('transactions:setSplits', (_, id: number, splits: Array<{ categoryId: number; amount: number }>) => {
    const transaction = db().prepare('SELECT amount, date FROM transactions WHERE id = ?').get(id) as { amount: number; date: string } | undefined
    if (!transaction) throw new Error('Transaction not found')
    assertMonthOpen(transaction.date)
    const clean = (splits ?? []).filter((split) => Number.isInteger(split.categoryId) && Number(split.amount) > 0)
    const total = round(clean.reduce((sum, split) => sum + Number(split.amount), 0))
    if (clean.length > 0 && Math.abs(total - round(transaction.amount)) > 0.01) {
      throw new Error(`Split amounts must total ${round(transaction.amount)}.`)
    }
    if (new Set(clean.map((split) => split.categoryId)).size !== clean.length) {
      throw new Error('Each split must use a different category.')
    }
    const save = db().transaction(() => {
      db().prepare('DELETE FROM transaction_splits WHERE transaction_id = ?').run(id)
      const insert = db().prepare('INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?, ?, ?)')
      for (const split of clean) insert.run(id, split.categoryId, round(split.amount))
    })
    save()
    return true
  })

  ipcMain.handle('transactions:setTags', (_, id: number, names: string[]) => {
    const row = db().prepare('SELECT date FROM transactions WHERE id = ?').get(id) as { date: string } | undefined
    if (!row) throw new Error('Transaction not found')
    assertMonthOpen(row.date)
    const clean = [...new Set((names ?? []).map((name) => name.trim()).filter(Boolean))].slice(0, 20)
    const save = db().transaction(() => {
      db().prepare('DELETE FROM transaction_tags WHERE transaction_id = ?').run(id)
      for (const name of clean) {
        db().prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(name)
        const tag = db().prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(name) as { id: number }
        db().prepare('INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)').run(id, tag.id)
      }
    })
    save()
    return db().prepare(`SELECT t.* FROM tags t JOIN transaction_tags tt ON tt.tag_id=t.id WHERE tt.transaction_id=? ORDER BY t.name`).all(id)
  })

  ipcMain.handle('transactions:setSharedExpenses', (_, id: number, shares: Array<{ memberId?: number | null; personName: string; amount: number; settled?: boolean }>) => {
    const transaction = db().prepare('SELECT amount, date, type FROM transactions WHERE id = ?').get(id) as { amount: number; date: string; type: string } | undefined
    if (!transaction) throw new Error('Transaction not found')
    if (transaction.type !== 'expense') throw new Error('Only expenses can be shared.')
    assertMonthOpen(transaction.date)
    const clean = (shares ?? []).filter((share) => share.personName?.trim() && Number(share.amount) >= 0)
    if (round(clean.reduce((sum, share) => sum + Number(share.amount), 0)) > round(transaction.amount)) {
      throw new Error('Shared amounts cannot exceed the transaction amount.')
    }
    const save = db().transaction(() => {
      db().prepare('DELETE FROM shared_expenses WHERE transaction_id = ?').run(id)
      const insert = db().prepare(`INSERT INTO shared_expenses (transaction_id, member_id, person_name, share_amount, settled) VALUES (?, ?, ?, ?, ?)`)
      for (const share of clean) insert.run(id, share.memberId ?? null, share.personName.trim(), round(share.amount), share.settled ? 1 : 0)
    })
    save()
    return true
  })

  ipcMain.handle('transactions:reconcile', (_, id: number, reconciled: boolean) => {
    const row = db().prepare('SELECT date FROM transactions WHERE id = ?').get(id) as { date: string } | undefined
    if (!row) throw new Error('Transaction not found')
    assertMonthOpen(row.date)
    db().prepare('UPDATE transactions SET reconciled = ?, reconciled_at = ? WHERE id = ?')
      .run(reconciled ? 1 : 0, reconciled ? new Date().toISOString() : null, id)
    return true
  })

  ipcMain.handle('transactions:addAttachment', async (_, id: number) => {
    const transaction = db().prepare('SELECT date FROM transactions WHERE id = ?').get(id) as { date: string } | undefined
    if (!transaction) throw new Error('Transaction not found')
    assertMonthOpen(transaction.date)
    const win = getWindow()
    const options = {
      title: 'Attach receipt or document',
      filters: [{ name: 'Receipts and documents', extensions: ['png', 'jpg', 'jpeg', 'webp', 'pdf'] }],
      properties: ['openFile'] as Array<'openFile'>
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const source = result.filePaths[0]
    const storedPath = join(getAttachmentDir(), `${id}-${randomUUID()}${extname(source).toLowerCase()}`)
    copyFileSync(source, storedPath)
    const inserted = db().prepare(`
      INSERT INTO transaction_attachments (transaction_id, file_name, stored_path, mime_type)
      VALUES (?, ?, ?, ?)
    `).run(id, basename(source), storedPath, extname(source).toLowerCase() === '.pdf' ? 'application/pdf' : 'image')
    return { id: Number(inserted.lastInsertRowid), file_name: basename(source), stored_path: storedPath }
  })

  ipcMain.handle('transactions:openAttachment', async (_, id: number) => {
    const attachment = db().prepare('SELECT stored_path FROM transaction_attachments WHERE id = ?').get(id) as { stored_path: string } | undefined
    if (!attachment || !existsSync(attachment.stored_path)) throw new Error('Attachment file is missing.')
    const error = await shell.openPath(attachment.stored_path)
    if (error) throw new Error(error)
    return true
  })

  ipcMain.handle('transactions:removeAttachment', (_, id: number) => {
    const attachment = db().prepare(`
      SELECT a.stored_path, t.date FROM transaction_attachments a
      JOIN transactions t ON t.id = a.transaction_id WHERE a.id = ?
    `).get(id) as { stored_path: string; date: string } | undefined
    if (!attachment) return false
    assertMonthOpen(attachment.date)
    db().prepare('DELETE FROM transaction_attachments WHERE id = ?').run(id)
    if (existsSync(attachment.stored_path)) unlinkSync(attachment.stored_path)
    return true
  })

  ipcMain.handle('transactions:refundCandidates', (_, id: number) => {
    const source = db().prepare('SELECT * FROM transactions WHERE id = ?').get(id) as { type: string; account_id: number; date: string } | undefined
    if (!source) return []
    const opposite = source.type === 'expense' ? 'income' : 'expense'
    return db().prepare(`
      SELECT id, COALESCE(merchant_name, description) AS description, amount, date, type
      FROM transactions
      WHERE id <> ? AND type = ? AND account_id = ?
        AND date BETWEEN date(?, '-120 days') AND date(?, '+120 days')
        AND NOT EXISTS (
          SELECT 1 FROM transaction_links l
          WHERE l.link_type='refund' AND (l.source_transaction_id=transactions.id OR l.linked_transaction_id=transactions.id)
        )
      ORDER BY ABS(julianday(date) - julianday(?)), ABS(amount - (SELECT amount FROM transactions WHERE id=?))
      LIMIT 20
    `).all(id, opposite, source.account_id, source.date, source.date, source.date, id)
  })

  ipcMain.handle('transactions:linkRefund', (_, sourceId: number, refundId: number) => {
    const rows = db().prepare('SELECT id, type, date FROM transactions WHERE id IN (?, ?)').all(sourceId, refundId) as Array<{ id: number; type: string; date: string }>
    if (rows.length !== 2 || rows[0].type === rows[1].type) throw new Error('A refund must link an expense and an income.')
    rows.forEach((row) => assertMonthOpen(row.date))
    const expenseId = rows.find((row) => row.type === 'expense')!.id
    const incomeId = rows.find((row) => row.type === 'income')!.id
    db().prepare(`INSERT OR IGNORE INTO transaction_links (source_transaction_id, linked_transaction_id, link_type) VALUES (?, ?, 'refund')`).run(expenseId, incomeId)
    return true
  })

  ipcMain.handle('transactions:unlinkRefund', (_, linkId: number) => {
    db().prepare('DELETE FROM transaction_links WHERE id = ?').run(linkId)
    return true
  })

  ipcMain.handle('transactions:transferCandidates', () => db().prepare(`
    SELECT e.id AS expense_id, i.id AS income_id, e.description, e.amount,
           e.date AS expense_date, i.date AS income_date,
           ea.name AS from_account, ia.name AS to_account
    FROM transactions e
    JOIN transactions i ON i.type='income' AND e.type='expense'
      AND round(i.amount, 2)=round(e.amount, 2)
      AND i.account_id <> e.account_id
      AND ABS(julianday(i.date)-julianday(e.date)) <= 3
    JOIN accounts ea ON ea.id=e.account_id
    JOIN accounts ia ON ia.id=i.account_id
    WHERE e.description NOT LIKE 'subscription:%'
    ORDER BY e.date DESC LIMIT 20
  `).all())

  ipcMain.handle('transactions:convertTransferPair', (_, expenseId: number, incomeId: number) => {
    const expense = db().prepare("SELECT * FROM transactions WHERE id=? AND type='expense'").get(expenseId) as { date: string; account_id: number } | undefined
    const income = db().prepare("SELECT * FROM transactions WHERE id=? AND type='income'").get(incomeId) as { date: string; account_id: number } | undefined
    if (!expense || !income || expense.account_id === income.account_id) throw new Error('Transfer pair is no longer valid.')
    assertMonthOpen(expense.date)
    assertMonthOpen(income.date)
    const convert = db().transaction(() => {
      updateTransaction({ id: expenseId, type: 'transfer', transfer_account_id: income.account_id, category_id: null })
      deleteTransaction(incomeId)
    })
    convert()
    return true
  })

  ipcMain.handle('reconciliation:preview', (_, accountId: number, statementDate: string, statementBalance: number) => {
    const calculatedBalance = accountBalanceAt(accountId, statementDate)
    return { calculatedBalance, statementBalance: round(statementBalance), difference: round(statementBalance - calculatedBalance) }
  })

  ipcMain.handle('reconciliation:complete', (_, accountId: number, statementDate: string, statementBalance: number) => {
    const preview = { calculatedBalance: accountBalanceAt(accountId, statementDate), statementBalance: round(statementBalance) }
    const difference = round(preview.statementBalance - preview.calculatedBalance)
    const save = db().transaction(() => {
      db().prepare(`
        INSERT INTO account_reconciliations (account_id, statement_date, statement_balance, calculated_balance, difference)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(account_id, statement_date) DO UPDATE SET
          statement_balance=excluded.statement_balance,
          calculated_balance=excluded.calculated_balance,
          difference=excluded.difference,
          created_at=datetime('now')
      `).run(accountId, statementDate, preview.statementBalance, preview.calculatedBalance, difference)
      db().prepare(`
        UPDATE transactions SET reconciled=1, reconciled_at=datetime('now')
        WHERE date <= ? AND (account_id=? OR transfer_account_id=?)
      `).run(statementDate, accountId, accountId)
    })
    save()
    return { ...preview, difference }
  })

  ipcMain.handle('reconciliation:history', (_, accountId: number) =>
    db().prepare('SELECT * FROM account_reconciliations WHERE account_id=? ORDER BY statement_date DESC LIMIT 12').all(accountId))

  ipcMain.handle('filters:list', () => {
    const rows = db().prepare('SELECT * FROM saved_filters ORDER BY name').all() as Array<{ id: number; name: string; filters_json: string }>
    return rows.map((row) => ({ ...row, filters: JSON.parse(row.filters_json) }))
  })

  ipcMain.handle('filters:save', (_, name: string, filters: Record<string, unknown>) => {
    if (!name?.trim()) throw new Error('Filter name is required.')
    db().prepare(`INSERT INTO saved_filters (name, filters_json) VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET filters_json=excluded.filters_json`).run(name.trim(), JSON.stringify(filters))
    return true
  })

  ipcMain.handle('filters:delete', (_, id: number) => {
    db().prepare('DELETE FROM saved_filters WHERE id=?').run(id)
    return true
  })

  ipcMain.handle('months:listClosed', () => db().prepare('SELECT * FROM closed_months ORDER BY year DESC, month DESC').all())
  ipcMain.handle('months:setClosed', (_, year: number, month: number, closed: boolean) => {
    if (closed) db().prepare('INSERT OR IGNORE INTO closed_months (year, month) VALUES (?, ?)').run(year, month)
    else db().prepare('DELETE FROM closed_months WHERE year=? AND month=?').run(year, month)
    return true
  })

  ipcMain.handle('merchants:listAliases', () => db().prepare('SELECT * FROM merchant_aliases ORDER BY merchant_name, pattern').all())
  ipcMain.handle('merchants:saveAlias', (_, pattern: string, merchantName: string) => {
    if (!pattern?.trim() || !merchantName?.trim()) throw new Error('Pattern and merchant name are required.')
    const save = db().transaction(() => {
      db().prepare(`INSERT INTO merchant_aliases (pattern, merchant_name) VALUES (?, ?)
        ON CONFLICT(pattern) DO UPDATE SET merchant_name=excluded.merchant_name`).run(pattern.trim(), merchantName.trim())
      db().prepare('UPDATE transactions SET merchant_name=? WHERE lower(description) LIKE ?')
        .run(merchantName.trim(), `%${pattern.trim().toLowerCase()}%`)
    })
    save()
    return true
  })
  ipcMain.handle('merchants:deleteAlias', (_, id: number) => {
    db().prepare('DELETE FROM merchant_aliases WHERE id=?').run(id)
    return true
  })

  ipcMain.handle('planning:cashFlowCalendar', (_, days = 35) => {
    const start = today()
    const end = addDays(start, Math.min(120, Math.max(7, Number(days) || 35)))
    const accounts = db().prepare('SELECT id FROM accounts WHERE is_archived=0').all() as Array<{ id: number }>
    let balance = round(accounts.reduce((sum, account) => sum + accountBalanceAt(account.id, start), 0))
    const events: Array<{ date: string; label: string; amount: number; type: string }> = []
    const recurring = [
      ...(db().prepare("SELECT name AS label, amount, next_billing_date AS date, frequency, 'subscription' AS type FROM subscriptions WHERE COALESCE(on_hold,0)=0").all() as Array<any>).map((row) => ({ ...row, amount: -Math.abs(row.amount) })),
      ...(db().prepare("SELECT name AS label, amount, next_billing_date AS date, frequency, 'income' AS type FROM income_sources WHERE COALESCE(is_recurring,1)=1").all() as Array<any>).map((row) => ({ ...row, amount: Math.abs(row.amount) })),
      ...(db().prepare("SELECT description AS label, amount, COALESCE((SELECT date FROM transactions WHERE id=s.transaction_id), date('now')) AS date, frequency, 'savings' AS type FROM savings_sources s WHERE COALESCE(is_recurring,1)=1").all() as Array<any>).map((row) => ({ ...row, amount: -Math.abs(row.amount) }))
    ]
    for (const item of recurring) {
      let date = String(item.date || start)
      while (date < start) date = advanceDate(date, item.frequency || 'monthly')
      while (date <= end) {
        events.push({ date, label: item.label, amount: round(item.amount), type: item.type })
        date = advanceDate(date, item.frequency || 'monthly')
      }
    }
    const grouped = new Map<string, typeof events>()
    for (const event of events) grouped.set(event.date, [...(grouped.get(event.date) ?? []), event])
    const result = []
    for (let date = start; date <= end; date = addDays(date, 1)) {
      const dayEvents = grouped.get(date) ?? []
      balance = round(balance + dayEvents.reduce((sum, event) => sum + event.amount, 0))
      result.push({ date, balance, events: dayEvents })
    }
    return result
  })

  ipcMain.handle('planning:expenseForecast', (_, year: number, month: number) => {
    const date = new Date()
    const isCurrent = year === date.getFullYear() && month === date.getMonth() + 1
    const elapsedDays = isCurrent ? date.getDate() : new Date(year, month, 0).getDate()
    const daysInMonth = new Date(year, month, 0).getDate()
    const row = db().prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM transactions WHERE type='expense' AND strftime('%Y',date)=? AND strftime('%m',date)=?`)
      .get(String(year), String(month).padStart(2, '0')) as { total: number }
    return { spent: round(row.total), projected: round((row.total / Math.max(1, elapsedDays)) * daysInMonth), elapsedDays, daysInMonth }
  })

  ipcMain.handle('planning:budgetSuggestions', (_, year: number, month: number) => {
    const anchor = `${year}-${String(month).padStart(2, '0')}-01`
    return db().prepare(`
      SELECT c.id AS category_id, c.name,
             ROUND(COALESCE(SUM(tca.amount),0)/3.0, 2) AS average,
             ROUND((COALESCE(SUM(tca.amount),0)/3.0 + 24.999)/50.0, 0)*50 AS suggested
      FROM categories c
      LEFT JOIN transaction_category_amounts tca ON tca.category_id=c.id AND tca.type='expense'
        AND tca.date >= date(?, '-3 months') AND tca.date < ?
      GROUP BY c.id HAVING average > 0 ORDER BY suggested DESC
    `).all(anchor, anchor)
  })

  ipcMain.handle('budget:getRollover', (_, year: number, month: number) => {
    const previous = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
    return db().prepare(`
      SELECT c.id AS category_id, c.name, COALESCE(br.enabled,0) AS enabled,
             MAX(0, COALESCE(be.amount,0)-COALESCE(SUM(tca.amount),0)) AS rollover
      FROM categories c
      LEFT JOIN budget_rollover br ON br.category_id=c.id
      LEFT JOIN budget_entries be ON be.category_id=c.id AND be.year=? AND be.month=?
      LEFT JOIN transaction_category_amounts tca ON tca.category_id=c.id AND tca.type='expense'
        AND strftime('%Y',tca.date)=? AND strftime('%m',tca.date)=?
      GROUP BY c.id ORDER BY c.sort_order, c.id
    `).all(previous.year, previous.month, String(previous.year), String(previous.month).padStart(2, '0'))
  })

  ipcMain.handle('budget:setRollover', (_, categoryId: number, enabled: boolean) => {
    db().prepare(`INSERT INTO budget_rollover (category_id,enabled) VALUES (?,?)
      ON CONFLICT(category_id) DO UPDATE SET enabled=excluded.enabled`).run(categoryId, enabled ? 1 : 0)
    return true
  })

  ipcMain.handle('budget:applySuggestions', (_, year: number, month: number, suggestions: Array<{ categoryId: number; amount: number }>) => {
    const apply = db().transaction(() => {
      const insert = db().prepare(`INSERT INTO budget_entries (category_id,year,month,amount)
        VALUES (?,?,?,?) ON CONFLICT(category_id,year,month) DO UPDATE SET amount=excluded.amount`)
      for (const item of suggestions) insert.run(item.categoryId, year, month, round(item.amount))
    })
    apply()
    return true
  })

  ipcMain.handle('alerts:financial', (_, year: number, month: number) => {
    const alerts: Array<{ severity: 'info' | 'warning' | 'critical'; title: string; detail: string }> = []
    const accounts = db().prepare('SELECT id,name FROM accounts WHERE is_archived=0').all() as Array<{ id: number; name: string }>
    for (const account of accounts) {
      const balance = accountBalanceAt(account.id, today())
      if (balance < 0) alerts.push({ severity: 'critical', title: `${account.name} is below zero`, detail: `Balance: ${balance}` })
      else if (balance < 500) alerts.push({ severity: 'warning', title: `${account.name} has a low balance`, detail: `Balance: ${balance}` })
    }
    const budgetRows = db().prepare(`
      SELECT c.name, be.amount AS budget, COALESCE(SUM(tca.amount),0) AS spent
      FROM budget_entries be JOIN categories c ON c.id=be.category_id
      LEFT JOIN transaction_category_amounts tca ON tca.category_id=be.category_id AND tca.type='expense'
        AND strftime('%Y',tca.date)=? AND strftime('%m',tca.date)=?
      WHERE be.year=? AND be.month=? GROUP BY be.id HAVING budget > 0 AND spent/budget >= .8
    `).all(String(year), String(month).padStart(2, '0'), year, month) as Array<{ name: string; budget: number; spent: number }>
    for (const row of budgetRows) alerts.push({ severity: row.spent > row.budget ? 'critical' : 'warning', title: `${row.name} budget`, detail: `${round(row.spent)} of ${round(row.budget)} used` })
    const unusual = db().prepare(`
      SELECT current.description, current.amount, ROUND(AVG(previous.amount), 2) AS usual_amount
      FROM transactions current
      JOIN transactions previous
        ON lower(COALESCE(previous.merchant_name, previous.description)) = lower(COALESCE(current.merchant_name, current.description))
       AND previous.type = 'expense' AND previous.date < date(current.date, 'start of month')
       AND previous.date >= date(current.date, 'start of month', '-6 months')
      WHERE current.type = 'expense' AND strftime('%Y', current.date) = ? AND strftime('%m', current.date) = ?
      GROUP BY current.id HAVING COUNT(previous.id) >= 2 AND current.amount >= AVG(previous.amount) * 2
      ORDER BY current.amount / AVG(previous.amount) DESC LIMIT 3
    `).all(String(year), String(month).padStart(2, '0')) as Array<{ description: string; amount: number; usual_amount: number }>
    for (const row of unusual) alerts.push({ severity: 'warning', title: `Unusually high: ${row.description}`, detail: `${round(row.amount)} compared with the usual ${round(row.usual_amount)}` })
    return alerts
  })

  ipcMain.handle('wealth:captureSnapshot', () => {
    const accounts = db().prepare('SELECT id,type FROM accounts WHERE is_archived=0').all() as Array<{ id: number; type: string }>
    const savings = round(accounts.filter((account) => account.type === 'savings').reduce((sum, account) => sum + accountBalanceAt(account.id, today()), 0))
    const otherAssets = round(accounts.filter((account) => account.type !== 'savings').reduce((sum, account) => sum + Math.max(0, accountBalanceAt(account.id, today())), 0))
    const investments = db().prepare('SELECT COALESCE(SUM(current_value),0) AS total FROM investment_holdings').get() as { total: number }
    const debts = db().prepare("SELECT COALESCE(SUM(MAX(0,target_amount-current_amount)),0) AS total FROM goals WHERE type='debt'").get() as { total: number }
    const result = db().prepare(`INSERT INTO wealth_snapshots (date,assets_savings,assets_investments,assets_property,liabilities_loans,liabilities_credit,notes)
      VALUES (?,?,?,?,?,?,?)`).run(today(), savings + otherAssets, round(investments.total), 0, round(debts.total), 0, 'Automatic snapshot')
    return { id: Number(result.lastInsertRowid) }
  })

  ipcMain.handle('goals:debtPlanner', (_, extraPayment = 0) => {
    const rows = db().prepare(`
      SELECT id,name,creditor,target_amount,current_amount,target_date,interest_rate,monthly_payment,next_payment_date,notes
      FROM goals WHERE type='debt' AND target_amount>0 ORDER BY CASE WHEN target_amount-current_amount > 0 THEN 0 ELSE 1 END, id
    `).all() as Array<{
      id: number; name: string; creditor: string | null; target_amount: number; current_amount: number
      target_date: string | null; interest_rate: number | null; monthly_payment: number | null; next_payment_date: string | null; notes: string | null
    }>
    const payments = db().prepare(`
      SELECT id,goal_id,amount,payment_date,note,transaction_id,principal_amount,interest_amount,fee_amount,created_at
      FROM debt_payments ORDER BY payment_date DESC,id DESC
    `).all() as Array<{ id: number; goal_id: number; amount: number; payment_date: string; note: string | null; transaction_id: number | null; principal_amount: number | null; interest_amount: number; fee_amount: number; created_at: string }>
    const debts = rows.map((goal) => {
      const paidAmount = Math.min(Math.max(0, Number(goal.current_amount) || 0), Math.max(0, Number(goal.target_amount) || 0))
      const debtPayments = payments.filter((payment) => payment.goal_id === goal.id)
      const trackedPaid = round(debtPayments.reduce((sum, payment) => sum + payment.amount, 0))
      return {
        id: goal.id,
        name: goal.name,
        creditor: goal.creditor?.trim() || goal.name,
        originalAmount: round(goal.target_amount),
        paidAmount: round(paidAmount),
        previouslyPaid: round(Math.max(0, paidAmount - trackedPaid)),
        balance: round(Math.max(0, goal.target_amount - paidAmount)),
        interestRate: Math.max(0, Number(goal.interest_rate) || 0),
        minimum: Math.max(0, Number(goal.monthly_payment) || 0),
        nextPaymentDate: goal.next_payment_date,
        targetDate: goal.target_date,
        notes: goal.notes,
        payments: debtPayments
      }
    })
    const openDebts = debts.filter((debt) => debt.balance > 0)
    const originalAmount = round(debts.reduce((sum, debt) => sum + debt.originalAmount, 0))
    const paidAmount = round(debts.reduce((sum, debt) => sum + debt.paidAmount, 0))
    return {
      debts,
      totals: {
        originalAmount,
        paidAmount,
        remainingAmount: round(Math.max(0, originalAmount - paidAmount)),
        monthlyMinimum: round(openDebts.reduce((sum, debt) => sum + debt.minimum, 0))
      },
      snowball: calculateDebtPayoffPlan(openDebts, 'snowball', Math.max(0, Number(extraPayment) || 0), today()),
      avalanche: calculateDebtPayoffPlan(openDebts, 'avalanche', Math.max(0, Number(extraPayment) || 0), today())
    }
  })

  ipcMain.handle('goals:paymentCandidates', () => db().prepare(`
    SELECT t.id,t.description,t.amount,t.date,t.type,a.name AS account_name
    FROM transactions t
    LEFT JOIN accounts a ON a.id=t.account_id
    LEFT JOIN debt_payments p ON p.transaction_id=t.id
    WHERE p.id IS NULL AND t.type='expense' AND t.date>=date('now','-12 months')
    ORDER BY t.date DESC,t.id DESC LIMIT 100
  `).all())

  ipcMain.handle('goals:addDebtPayment', (_, goalId: number, input: { amount: number; date: string; note?: string; transactionId?: number; principalAmount?: number; interestAmount?: number; feeAmount?: number }) => {
    const goal = db().prepare("SELECT * FROM goals WHERE id=? AND type='debt'").get(goalId) as {
      id: number; name: string; type: string; target_amount: number; current_amount: number; target_date: string | null; next_payment_date: string | null
    } | undefined
    if (!goal) throw new Error('Debt not found.')
    let amount = round(input.amount)
    let paymentDate = input.date
    if (input.transactionId) {
      const transaction = db().prepare("SELECT id,amount,date,type FROM transactions WHERE id=?").get(input.transactionId) as { id: number; amount: number; date: string; type: string } | undefined
      if (!transaction || transaction.type !== 'expense') throw new Error('Choose an expense transaction for this debt payment.')
      const linked = db().prepare('SELECT id FROM debt_payments WHERE transaction_id=?').get(input.transactionId)
      if (linked) throw new Error('That transaction is already linked to a debt payment.')
      amount = round(transaction.amount)
      paymentDate = transaction.date
    }
    const remaining = round(Math.max(0, goal.target_amount - goal.current_amount))
    const breakdown = normalizeDebtPaymentBreakdown(amount, remaining, input.principalAmount, input.interestAmount, input.feeAmount)
    const { principal, interest, fee } = breakdown
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) throw new Error('Choose a valid payment date.')
    const nextCurrent = round(goal.current_amount + principal)
    const nextPaymentDate = goal.next_payment_date && paymentDate >= goal.next_payment_date ? addMonths(goal.next_payment_date, 1) : goal.next_payment_date
    const hmac = signGoal({ ...goal, current_amount: nextCurrent })
    const save = db().transaction(() => {
      const result = db().prepare('INSERT INTO debt_payments (goal_id,amount,payment_date,note,transaction_id,principal_amount,interest_amount,fee_amount) VALUES (?,?,?,?,?,?,?,?)')
        .run(goalId, amount, paymentDate, input.note?.trim().slice(0, 500) || null, input.transactionId ?? null, principal, interest, fee)
      db().prepare('UPDATE goals SET current_amount=?,next_payment_date=?,hmac=? WHERE id=?').run(nextCurrent, nextPaymentDate, hmac, goalId)
      return { id: Number(result.lastInsertRowid) }
    })
    return save()
  })

  ipcMain.handle('goals:deleteDebtPayment', (_, paymentId: number) => {
    const payment = db().prepare(`
      SELECT p.id,p.amount,p.principal_amount,p.goal_id,g.name,g.type,g.target_amount,g.current_amount,g.target_date
      FROM debt_payments p JOIN goals g ON g.id=p.goal_id WHERE p.id=?
    `).get(paymentId) as {
      id: number; amount: number; principal_amount: number | null; goal_id: number; name: string; type: string
      target_amount: number; current_amount: number; target_date: string | null
    } | undefined
    if (!payment) throw new Error('Debt payment not found.')
    const nextCurrent = round(Math.max(0, payment.current_amount - (payment.principal_amount ?? payment.amount)))
    const hmac = signGoal({ ...payment, current_amount: nextCurrent })
    const remove = db().transaction(() => {
      db().prepare('DELETE FROM debt_payments WHERE id=?').run(paymentId)
      db().prepare('UPDATE goals SET current_amount=?,hmac=? WHERE id=?').run(nextCurrent, hmac, payment.goal_id)
    })
    remove()
    return true
  })

  ipcMain.handle('planning:scenario', (_, input: { incomeChangePercent?: number; expenseChangePercent?: number; recurringIncrease?: number }) => {
    const base = db().prepare(`
      SELECT COALESCE(AVG(income),0) AS income, COALESCE(AVG(expenses),0) AS expenses FROM (
        SELECT strftime('%Y-%m',date) AS month,
          SUM(CASE WHEN type='income' THEN amount ELSE 0 END) AS income,
          SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) AS expenses
        FROM transactions WHERE date >= date('now','-6 months') GROUP BY month
      )
    `).get() as { income: number; expenses: number }
    const income = base.income * (1 + (Number(input.incomeChangePercent) || 0) / 100)
    const expenses = base.expenses * (1 + (Number(input.expenseChangePercent) || 0) / 100) + (Number(input.recurringIncrease) || 0)
    return { baseline: { income: round(base.income), expenses: round(base.expenses), net: round(base.income - base.expenses) }, scenario: { income: round(income), expenses: round(expenses), net: round(income - expenses) } }
  })

  ipcMain.handle('planning:safeToSpend', (_, year: number, month: number) => {
    const ym = `${year}-${String(month).padStart(2, '0')}`
    const actual = db().prepare(`SELECT
      COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) AS income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS spent
      FROM transactions WHERE strftime('%Y-%m',date)=?`).get(ym) as { income: number; spent: number }
    const incomeSources = db().prepare('SELECT amount,frequency FROM income_sources WHERE COALESCE(is_recurring,0)=1').all() as Array<{ amount: number; frequency: string | null }>
    const plannedIncome = incomeSources.reduce((sum, row) => sum + monthlyAmount(row.amount, row.frequency), 0)
    const categorySpend = db().prepare(`SELECT category_id,COALESCE(SUM(amount),0) AS spent FROM transaction_category_amounts WHERE type='expense' AND strftime('%Y-%m',date)=? GROUP BY category_id`).all(ym) as Array<{ category_id: number; spent: number }>
    const spendMap = new Map(categorySpend.map((row) => [row.category_id, row.spent]))
    const budgets = db().prepare(`SELECT c.id,COALESCE(be.amount,c.budget_amount,0) AS amount FROM categories c LEFT JOIN budget_entries be ON be.category_id=c.id AND be.year=? AND be.month=?`).all(year, month) as Array<{ id: number; amount: number }>
    const reservedBudget = budgets.reduce((sum, row) => sum + Math.max(0, row.amount - (spendMap.get(row.id) ?? 0)), 0)
    const subscriptions = db().prepare("SELECT amount,frequency,next_billing_date FROM subscriptions WHERE COALESCE(on_hold,0)=0").all() as Array<{ amount: number; frequency: string | null; next_billing_date: string | null }>
    const upcomingBills = subscriptions.reduce((sum, row) => {
      if (row.next_billing_date) return row.next_billing_date.slice(0, 7) === ym ? sum + row.amount : sum
      return sum + monthlyAmount(row.amount, row.frequency)
    }, 0)
    const savings = db().prepare('SELECT amount,frequency FROM savings_sources').all() as Array<{ amount: number; frequency: string | null }>
    const savingsCommitments = savings.reduce((sum, row) => sum + monthlyAmount(row.amount, row.frequency), 0)
    const debt = db().prepare("SELECT COALESCE(SUM(g.monthly_payment),0) AS total FROM goals g WHERE g.type='debt' AND g.current_amount<g.target_amount AND NOT EXISTS (SELECT 1 FROM debt_payments p WHERE p.goal_id=g.id AND strftime('%Y-%m',p.payment_date)=?)").get(ym) as { total: number }
    const expectedIncome = Math.max(actual.income, plannedIncome)
    const available = round(expectedIncome - actual.spent - reservedBudget - upcomingBills - savingsCommitments - debt.total)
    const now = new Date()
    const daysInMonth = new Date(year, month, 0).getDate()
    const daysRemaining = year === now.getFullYear() && month === now.getMonth() + 1 ? Math.max(1, daysInMonth - now.getDate() + 1) : daysInMonth
    return {
      available,
      perDay: round(available / daysRemaining),
      daysRemaining,
      components: { expectedIncome: round(expectedIncome), spent: round(actual.spent), reservedBudget: round(reservedBudget), upcomingBills: round(upcomingBills), savingsCommitments: round(savingsCommitments), debtMinimums: round(debt.total) }
    }
  })

  ipcMain.handle('review:inbox', () => {
    type ReviewItem = { key: string; kind: string; severity: 'info' | 'warning' | 'critical'; title: string; detail: string; transactionIds?: number[] }
    const items: ReviewItem[] = []
    const duplicates = db().prepare(`SELECT lower(trim(description)) AS description,round(amount,2) AS amount,date,group_concat(id) AS ids,COUNT(*) AS count FROM transactions GROUP BY lower(trim(description)),round(amount,2),type,account_id,date HAVING COUNT(*)>1 LIMIT 30`).all() as Array<{ description: string; amount: number; date: string; ids: string; count: number }>
    duplicates.forEach((row) => items.push({ key: `duplicate:${row.description}:${row.amount}:${row.date}`, kind: 'duplicate', severity: 'warning', title: `${row.count} possible duplicate transactions`, detail: `${row.description} · ${row.amount} · ${row.date}`, transactionIds: row.ids.split(',').map(Number) }))
    const uncategorized = db().prepare("SELECT id,description,amount,date FROM transactions WHERE type='expense' AND category_id IS NULL AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id=transactions.id) ORDER BY date DESC LIMIT 40").all() as Array<{ id: number; description: string; amount: number; date: string }>
    uncategorized.forEach((row) => items.push({ key: `uncategorized:${row.id}`, kind: 'uncategorized', severity: 'warning', title: 'Uncategorized purchase', detail: `${row.description} · ${row.amount} · ${row.date}`, transactionIds: [row.id] }))
    const pairRows = db().prepare(`SELECT e.id AS expense_id,i.id AS income_id,e.description,e.amount,e.date FROM transactions e JOIN transactions i ON i.type='income' AND e.type='expense' AND i.account_id<>e.account_id AND abs(i.amount-e.amount)<0.01 AND abs(julianday(i.date)-julianday(e.date))<=2 LEFT JOIN debt_payments p ON p.transaction_id=e.id WHERE p.id IS NULL LIMIT 30`).all() as Array<{ expense_id: number; income_id: number; description: string; amount: number; date: string }>
    pairRows.forEach((row) => items.push({ key: `transfer:${row.expense_id}:${row.income_id}`, kind: 'transfer', severity: 'info', title: 'Possible account transfer', detail: `${row.description} · ${row.amount} · ${row.date}`, transactionIds: [row.expense_id, row.income_id] }))
    const refunds = db().prepare(`SELECT e.id AS expense_id,i.id AS income_id,e.description,e.amount,i.date FROM transactions e JOIN transactions i ON e.type='expense' AND i.type='income' AND i.account_id=e.account_id AND abs(i.amount-e.amount)<0.01 AND i.date>=e.date AND julianday(i.date)-julianday(e.date)<=90 LEFT JOIN transaction_links l ON l.source_transaction_id=e.id AND l.linked_transaction_id=i.id WHERE l.id IS NULL LIMIT 30`).all() as Array<{ expense_id: number; income_id: number; description: string; amount: number; date: string }>
    refunds.forEach((row) => items.push({ key: `refund:${row.expense_id}:${row.income_id}`, kind: 'refund', severity: 'info', title: 'Possible refund match', detail: `${row.description} · ${row.amount} · returned ${row.date}`, transactionIds: [row.expense_id, row.income_id] }))
    const unusual = db().prepare(`SELECT id,description,amount,date FROM transactions WHERE type='expense' AND date>=date('now','-90 days') AND amount>(SELECT MAX(1000,COALESCE(AVG(amount),0)*3) FROM transactions WHERE type='expense' AND date>=date('now','-180 days')) ORDER BY amount DESC LIMIT 20`).all() as Array<{ id: number; description: string; amount: number; date: string }>
    unusual.forEach((row) => items.push({ key: `unusual:${row.id}`, kind: 'unusual', severity: 'warning', title: 'Unusual transaction', detail: `${row.description} · ${row.amount} · ${row.date}`, transactionIds: [row.id] }))
    const due = db().prepare("SELECT id,name,amount,next_billing_date FROM subscriptions WHERE COALESCE(on_hold,0)=0 AND next_billing_date IS NOT NULL AND date(next_billing_date)<=date('now','+7 days') ORDER BY next_billing_date LIMIT 20").all() as Array<{ id: number; name: string; amount: number; next_billing_date: string }>
    due.forEach((row) => items.push({ key: `subscription:${row.id}:${row.next_billing_date}`, kind: 'subscription', severity: row.next_billing_date < today() ? 'critical' : 'warning', title: row.next_billing_date < today() ? 'Overdue recurring payment' : 'Recurring payment due soon', detail: `${row.name} · ${row.amount} · ${row.next_billing_date}` }))
    const accounts = db().prepare(`SELECT a.id,a.name,MAX(r.statement_date) AS last_date FROM accounts a LEFT JOIN account_reconciliations r ON r.account_id=a.id WHERE a.is_archived=0 GROUP BY a.id HAVING last_date IS NULL OR date(last_date)<date('now','-45 days')`).all() as Array<{ id: number; name: string; last_date: string | null }>
    accounts.forEach((row) => items.push({ key: `reconcile:${row.id}:${row.last_date ?? 'never'}`, kind: 'reconciliation', severity: 'info', title: 'Account needs reconciliation', detail: `${row.name} · ${row.last_date ? `last reconciled ${row.last_date}` : 'never reconciled'}` }))
    const debts = db().prepare("SELECT id,name,next_payment_date,monthly_payment FROM goals WHERE type='debt' AND current_amount<target_amount AND next_payment_date IS NOT NULL AND date(next_payment_date)<=date('now','+7 days')").all() as Array<{ id: number; name: string; next_payment_date: string; monthly_payment: number }>
    debts.forEach((row) => items.push({ key: `debt-due:${row.id}:${row.next_payment_date}`, kind: 'debt', severity: row.next_payment_date < today() ? 'critical' : 'warning', title: row.next_payment_date < today() ? 'Debt payment overdue' : 'Debt payment due soon', detail: `${row.name} · minimum ${row.monthly_payment || 0} · ${row.next_payment_date}` }))
    const missingAccounts = (db().prepare('SELECT COUNT(*) AS count FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id WHERE a.id IS NULL').get() as { count: number }).count
    if (missingAccounts > 0) items.push({ key: `quality:missing-accounts:${missingAccounts}`, kind: 'quality', severity: 'critical', title: 'Transactions reference missing accounts', detail: `${missingAccounts} transaction${missingAccounts === 1 ? '' : 's'} need repair.` })
    const attachmentRows = db().prepare('SELECT id,stored_path FROM transaction_attachments').all() as Array<{ id: number; stored_path: string }>
    const missingAttachments = attachmentRows.filter((attachment) => !attachment.stored_path || !existsSync(attachment.stored_path)).length
    if (missingAttachments > 0) items.push({ key: `quality:missing-attachments:${missingAttachments}`, kind: 'quality', severity: 'warning', title: 'Attachment files are missing', detail: `${missingAttachments} attachment reference${missingAttachments === 1 ? '' : 's'} cannot be opened.` })
    const dismissed = new Set((db().prepare('SELECT item_key FROM review_dismissals').all() as Array<{ item_key: string }>).map((row) => row.item_key))
    return items.filter((item) => !dismissed.has(item.key)).sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.severity] - { critical: 0, warning: 1, info: 2 }[b.severity]))
  })

  ipcMain.handle('review:dismiss', (_, key: string) => {
    db().prepare('INSERT OR REPLACE INTO review_dismissals (item_key) VALUES (?)').run(String(key).slice(0, 500))
    return true
  })

  ipcMain.handle('importProfiles:list', () => db().prepare('SELECT * FROM import_profiles ORDER BY name').all().map((row: any) => ({ ...row, mapping: JSON.parse(row.mapping_json) })))
  ipcMain.handle('importProfiles:save', (_, input: { id?: number; name: string; accountId?: number; mapping: unknown }) => {
    if (!input.name?.trim()) throw new Error('Profile name is required.')
    if (input.id) {
      db().prepare("UPDATE import_profiles SET name=?,account_id=?,mapping_json=?,updated_at=datetime('now') WHERE id=?").run(input.name.trim(), input.accountId ?? null, JSON.stringify(input.mapping), input.id)
      return { id: input.id }
    }
    const result = db().prepare('INSERT INTO import_profiles (name,account_id,mapping_json) VALUES (?,?,?)').run(input.name.trim(), input.accountId ?? null, JSON.stringify(input.mapping))
    return { id: Number(result.lastInsertRowid) }
  })
  ipcMain.handle('importProfiles:delete', (_, id: number) => { db().prepare('DELETE FROM import_profiles WHERE id=?').run(id); return true })
  ipcMain.handle('importProfiles:history', () => db().prepare('SELECT s.*,p.name AS profile_name FROM import_sessions s LEFT JOIN import_profiles p ON p.id=s.profile_id ORDER BY s.created_at DESC,s.id DESC LIMIT 50').all())
  ipcMain.handle('importProfiles:record', (_, input: { profileId?: number; sourceName?: string; imported: number; duplicates?: number; errors?: number }) => {
    const result = db().prepare('INSERT INTO import_sessions (profile_id,source_name,imported_count,duplicate_count,error_count) VALUES (?,?,?,?,?)').run(input.profileId ?? null, input.sourceName?.slice(0, 200) ?? null, input.imported, input.duplicates ?? 0, input.errors ?? 0)
    return { id: Number(result.lastInsertRowid) }
  })

  ipcMain.handle('scenarios:list', () => db().prepare('SELECT * FROM financial_scenarios ORDER BY updated_at DESC,id DESC').all().map((row: any) => ({ ...row, events: JSON.parse(row.events_json) })))
  ipcMain.handle('scenarios:save', (_, input: { id?: number; name: string; events: unknown[] }) => {
    if (!input.name?.trim()) throw new Error('Scenario name is required.')
    if (input.id) {
      db().prepare("UPDATE financial_scenarios SET name=?,events_json=?,updated_at=datetime('now') WHERE id=?").run(input.name.trim(), JSON.stringify(input.events ?? []), input.id)
      return { id: input.id }
    }
    const result = db().prepare('INSERT INTO financial_scenarios (name,events_json) VALUES (?,?)').run(input.name.trim(), JSON.stringify(input.events ?? []))
    return { id: Number(result.lastInsertRowid) }
  })
  ipcMain.handle('scenarios:delete', (_, id: number) => { db().prepare('DELETE FROM financial_scenarios WHERE id=?').run(id); return true })
  ipcMain.handle('scenarios:project', (_, events: Array<{ date: string; type: 'income' | 'expense' | 'debt' | 'one-time'; amount: number; label?: string }>) => {
    const base = db().prepare(`SELECT COALESCE(AVG(income),0) AS income,COALESCE(AVG(expenses),0) AS expenses FROM (SELECT strftime('%Y-%m',date) AS month,SUM(CASE WHEN type='income' THEN amount ELSE 0 END) AS income,SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) AS expenses FROM transactions WHERE date>=date('now','-6 months') GROUP BY month)`).get() as { income: number; expenses: number }
    let balance = 0
    const start = new Date(); start.setDate(1)
    return Array.from({ length: 12 }, (_, index) => {
      const date = new Date(start.getFullYear(), start.getMonth() + index, 1)
      const period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      const active = (events ?? []).filter((event) => {
        const eventPeriod = event.date?.slice(0, 7)
        return event.type === 'income' || event.type === 'expense' ? eventPeriod <= period : eventPeriod === period
      })
      const income = round(base.income + active.filter((event) => event.type === 'income').reduce((sum, event) => sum + Number(event.amount || 0), 0))
      const expenses = round(base.expenses + active.filter((event) => event.type !== 'income').reduce((sum, event) => sum + Number(event.amount || 0), 0))
      balance = round(balance + income - expenses)
      return { period, income, expenses, net: round(income - expenses), balance, events: active }
    })
  })

  ipcMain.handle('tax:overview', (_, year: number) => {
    const estimates = db().prepare('SELECT COALESCE(SUM(income_gross),0) AS gross, COALESCE(SUM(income_net_actual),0) AS net FROM tax_estimates WHERE year=?').get(year) as { gross: number; net: number }
    const settings = db().prepare('SELECT expected_yearly_tax_owed FROM tax_year_settings WHERE year=?').get(year) as { expected_yearly_tax_owed: number | null } | undefined
    const deductible = db().prepare(`
      SELECT COALESCE(SUM(t.amount),0) AS total FROM transactions t
      LEFT JOIN subscriptions s ON s.transaction_id=t.id
      WHERE strftime('%Y',t.date)=? AND (COALESCE(s.tax_deductible,0)=1 OR lower(COALESCE(t.notes,'')) LIKE '%tax deductible%')
    `).get(String(year)) as { total: number }
    const withheld = round(estimates.gross - estimates.net)
    const expected = settings?.expected_yearly_tax_owed ?? null
    return { grossIncome: round(estimates.gross), netIncome: round(estimates.net), withheld, deductibleExpenses: round(deductible.total), expectedTax: expected, difference: expected == null ? null : round(withheld - expected) }
  })

  ipcMain.handle('reports:exportFinanceCsv', async (_, year: number, month?: number) => {
    const win = getWindow()
    const suffix = month ? `${year}-${String(month).padStart(2, '0')}` : String(year)
    const options = { title: 'Export financial report', defaultPath: `budget-report-${suffix}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    const rows = reportRows(year, month)
    writeFileSync(result.filePath, buildCsv(rows), 'utf8')
    return { filePath: result.filePath, rowCount: rows.length }
  })

  ipcMain.handle('reports:exportFinancePdf', async (_, year: number, month?: number) => {
    const win = getWindow()
    const suffix = month ? `${year}-${String(month).padStart(2, '0')}` : String(year)
    const options = { title: 'Export financial report', defaultPath: `budget-report-${suffix}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    const rows = reportRows(year, month)
    const totals = rows.reduce<{ income: number; expenses: number; savings: number }>((value, row) => {
      const amount = Number(row.amount) || 0
      if (row.type === 'income') value.income += amount
      if (row.type === 'expense') value.expenses += amount
      if (row.type === 'savings') value.savings += amount
      return value
    }, { income: 0, expenses: 0, savings: 0 })
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;padding:32px;color:#111}h1{font-size:24px}.summary{display:flex;gap:28px;margin:20px 0}table{border-collapse:collapse;width:100%;font-size:11px}th,td{padding:7px;border-bottom:1px solid #ddd;text-align:left}th{background:#f3f4f6}.num{text-align:right}</style></head><body><h1>Budget report ${escapeHtml(suffix)}</h1><div class="summary"><div>Income<br><b>${round(totals.income)}</b></div><div>Expenses<br><b>${round(totals.expenses)}</b></div><div>Savings<br><b>${round(totals.savings)}</b></div><div>Net<br><b>${round(totals.income-totals.expenses-totals.savings)}</b></div></div><table><thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Category</th><th>Account</th><th class="num">Amount</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.description)}</td><td>${escapeHtml(row.type)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.account)}</td><td class="num">${escapeHtml(row.amount)}</td></tr>`).join('')}</tbody></table></body></html>`
    const reportWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    try {
      await reportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      const pdf = await reportWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
      writeFileSync(result.filePath, pdf)
    } finally {
      reportWindow.destroy()
    }
    return { filePath: result.filePath, rowCount: rows.length }
  })

  ipcMain.handle('data:qualityStatus', () => {
    const one = (sql: string): number => (db().prepare(sql).get() as { count: number }).count
    const attachmentRows = db().prepare('SELECT stored_path FROM transaction_attachments').all() as Array<{ stored_path: string }>
    return {
      uncategorized: one("SELECT COUNT(*) AS count FROM transactions WHERE type='expense' AND category_id IS NULL AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id=transactions.id)"),
      missingAccounts: one('SELECT COUNT(*) AS count FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id WHERE a.id IS NULL'),
      duplicateCandidates: one(`SELECT COUNT(*) AS count FROM (SELECT 1 FROM transactions GROUP BY lower(trim(description)),round(amount,2),type,account_id,date HAVING COUNT(*)>1)`),
      missingAttachments: attachmentRows.filter((attachment) => !attachment.stored_path || !existsSync(attachment.stored_path)).length,
      unreconciled: one('SELECT COUNT(*) AS count FROM transactions WHERE COALESCE(reconciled,0)=0'),
      unnormalizedMerchants: one("SELECT COUNT(*) AS count FROM transactions WHERE merchant_name IS NULL OR trim(merchant_name)=''")
    }
  })

  ipcMain.handle('data:verifyBackup', async () => {
    const win = getWindow()
    const options = { title: 'Select a Budget SQLite backup', filters: [{ name: 'SQLite database', extensions: ['db', 'sqlite'] }], properties: ['openFile'] as Array<'openFile'> }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const path = result.filePaths[0]
    const dek = getDEK()
    if (!dek) throw new Error('Unlock the database before verifying a backup.')
    const backup = new SqlCipher(path, { readonly: true })
    try {
      backup.pragma(`key = "x'${dek.toString('hex')}'"`)
      const quickCheck = backup.pragma('quick_check') as Array<{ quick_check: string }>
      const tables = backup.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'").get() as { count: number }
      const transactions = backup.prepare('SELECT COUNT(*) AS count FROM transactions').get() as { count: number }
      return { valid: quickCheck.every((row) => row.quick_check === 'ok'), tables: tables.count, transactions: transactions.count, filePath: path }
    } finally {
      backup.close()
    }
  })

  ipcMain.handle('transactions:globalHistory', (_, limit = 100) => {
    const rows = db().prepare(`
      SELECT e.event_id, e.transaction_id, e.event_type AS action, e.payload_json, e.created_at AS timestamp,
             e.actor, COALESCE(t.merchant_name,t.description) AS current_description
      FROM transaction_events e LEFT JOIN transactions t ON t.id=e.transaction_id
      ORDER BY e.event_id DESC LIMIT ?
    `).all(Math.min(500, Math.max(1, Number(limit) || 100))) as Array<Record<string, unknown>>
    return rows.map((row) => ({ ...row, payload: JSON.parse(String(row.payload_json)), payload_json: undefined }))
  })

  ipcMain.handle('transactions:restoreEvent', (_, transactionId: number, eventId: number) =>
    restoreTransactionToEvent(transactionId, eventId))
}
