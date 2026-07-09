import { getDatabase } from '../database-encrypted'
import { signTransaction } from '../crypto/integrity'
import { 
  appendEvent, 
  TransactionEventType, 
  TransactionEventPayload,
  replayTransactionEvents,
  undoLastEvents,
  replayAllEvents
} from '../events/event-store'

/**
 * Command: Create a new transaction
 */
export interface CreateTransactionCommand {
  description: string
  amount: number
  type: 'expense' | 'income' | 'savings' | 'transfer'
  account_id?: number | null
  category_id?: number | null
  date: string
  is_recurring?: boolean
  is_unnecessary?: boolean
  member_id?: number | null
  notes?: string | null
}

export interface DuplicateTransactionHit {
  id: number
  description: string
  amount: number
  type: string
  account_id: number | null
  date: string
}

function getPrimaryAccountId(): number {
  const db = getDatabase()
  const existing = db
    .prepare("SELECT id FROM accounts WHERE is_archived = 0 ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined
  if (existing) return existing.id

  const result = db
    .prepare("INSERT INTO accounts (name, type, currency, is_archived) VALUES ('Main', 'checking', 'SEK', 0)")
    .run()
  return Number(result.lastInsertRowid)
}

function roundAmount(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

export function findDuplicateTransactions(
  command: Pick<CreateTransactionCommand, 'description' | 'amount' | 'type' | 'account_id' | 'date'>
): DuplicateTransactionHit[] {
  const db = getDatabase()
  const description = String(command.description ?? '').trim()
  const accountId = command.account_id ?? getPrimaryAccountId()

  return db.prepare(`
    SELECT id, description, amount, type, account_id, date
    FROM transactions
    WHERE lower(trim(description)) = lower(trim(?))
      AND round(amount, 2) = round(?, 2)
      AND type = ?
      AND account_id = ?
      AND date = ?
    ORDER BY id DESC
  `).all(description, roundAmount(command.amount), command.type, accountId, command.date) as DuplicateTransactionHit[]
}

export function hasDuplicateTransaction(
  command: Pick<CreateTransactionCommand, 'description' | 'amount' | 'type' | 'account_id' | 'date'>
): boolean {
  return findDuplicateTransactions(command).length > 0
}

export function createTransaction(command: CreateTransactionCommand): { id: number } {
  const db = getDatabase()
  
  const tx = db.transaction((cmd: CreateTransactionCommand) => {
    const accountId = cmd.account_id ?? getPrimaryAccountId()
    // Compute HMAC for the transaction
    const hmac = signTransaction({
      description: cmd.description,
      amount: cmd.amount,
      type: cmd.type,
      account_id: accountId,
      category_id: cmd.category_id ?? null,
      date: cmd.date,
      member_id: cmd.member_id ?? null
    })
    
    // Insert into materialized view (transactions table)
    const result = db.prepare(`
      INSERT INTO transactions (
        description, amount, type, account_id, category_id, date,
        is_recurring, is_unnecessary, member_id, notes, hmac
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cmd.description,
      cmd.amount,
      cmd.type,
      accountId,
      cmd.category_id ?? null,
      cmd.date,
      cmd.is_recurring ? 1 : 0,
      cmd.is_unnecessary ? 1 : 0,
      cmd.member_id ?? null,
      cmd.notes ?? null,
      hmac
    )
    
    const transactionId = Number(result.lastInsertRowid)
    
    // Append event to event store
    appendEvent(transactionId, TransactionEventType.CREATED, {
      description: cmd.description,
      amount: cmd.amount,
      type: cmd.type,
      account_id: accountId,
      category_id: cmd.category_id ?? null,
      date: cmd.date,
      is_recurring: cmd.is_recurring ?? false,
      is_unnecessary: cmd.is_unnecessary ?? false,
      member_id: cmd.member_id ?? null,
      notes: cmd.notes ?? null
    })
    
    return { id: transactionId }
  })
  
  return tx(command)
}

/**
 * Command: Update an existing transaction
 */
export interface UpdateTransactionCommand {
  id: number
  description?: string
  amount?: number
  type?: 'expense' | 'income' | 'savings' | 'transfer'
  account_id?: number | null
  category_id?: number | null
  date?: string
  is_recurring?: boolean
  is_unnecessary?: boolean
  member_id?: number | null
  notes?: string | null
}

export function updateTransaction(command: UpdateTransactionCommand): boolean {
  const db = getDatabase()
  
  const tx = db.transaction((cmd: UpdateTransactionCommand) => {
    // Get current state for event history
    const current = db.prepare('SELECT * FROM transactions WHERE id = ?').get(cmd.id) as any
    
    if (!current) {
      throw new Error(`Transaction ${cmd.id} not found`)
    }
    
    // Build update payload with only changed fields
    const updates: Partial<CreateTransactionCommand> = {}
    const previousValues: Partial<CreateTransactionCommand> = {}
    
    if (cmd.description !== undefined && cmd.description !== current.description) {
      updates.description = cmd.description
      previousValues.description = current.description
    }
    if (cmd.amount !== undefined && cmd.amount !== current.amount) {
      updates.amount = cmd.amount
      previousValues.amount = current.amount
    }
    if (cmd.type !== undefined && cmd.type !== current.type) {
      updates.type = cmd.type
      previousValues.type = current.type
    }
    if (cmd.account_id !== undefined && cmd.account_id !== current.account_id) {
      updates.account_id = cmd.account_id
      previousValues.account_id = current.account_id
    }
    if (cmd.category_id !== undefined && cmd.category_id !== current.category_id) {
      updates.category_id = cmd.category_id
      previousValues.category_id = current.category_id
    }
    if (cmd.date !== undefined && cmd.date !== current.date) {
      updates.date = cmd.date
      previousValues.date = current.date
    }
    if (cmd.is_recurring !== undefined && (cmd.is_recurring ? 1 : 0) !== current.is_recurring) {
      updates.is_recurring = cmd.is_recurring
      previousValues.is_recurring = current.is_recurring === 1
    }
    if (cmd.is_unnecessary !== undefined && (cmd.is_unnecessary ? 1 : 0) !== current.is_unnecessary) {
      updates.is_unnecessary = cmd.is_unnecessary
      previousValues.is_unnecessary = current.is_unnecessary === 1
    }
    if (cmd.member_id !== undefined && cmd.member_id !== current.member_id) {
      updates.member_id = cmd.member_id
      previousValues.member_id = current.member_id
    }
    if (cmd.notes !== undefined && cmd.notes !== current.notes) {
      updates.notes = cmd.notes
      previousValues.notes = current.notes
    }
    
    if (Object.keys(updates).length === 0) {
      return true // No changes
    }
    
    // Compute new HMAC
    const hmac = signTransaction({
      description: cmd.description ?? current.description,
      amount: cmd.amount ?? current.amount,
      type: cmd.type ?? current.type,
      account_id: cmd.account_id !== undefined ? cmd.account_id : current.account_id,
      category_id: cmd.category_id !== undefined ? cmd.category_id : current.category_id,
      date: cmd.date ?? current.date,
      member_id: cmd.member_id !== undefined ? cmd.member_id : current.member_id
    })
    
    // Update materialized view
    const setClauses: string[] = []
    const values: any[] = []
    
    if (cmd.description !== undefined) {
      setClauses.push('description = ?')
      values.push(cmd.description)
    }
    if (cmd.amount !== undefined) {
      setClauses.push('amount = ?')
      values.push(cmd.amount)
    }
    if (cmd.type !== undefined) {
      setClauses.push('type = ?')
      values.push(cmd.type)
    }
    if (cmd.account_id !== undefined) {
      setClauses.push('account_id = ?')
      values.push(cmd.account_id)
    }
    if (cmd.category_id !== undefined) {
      setClauses.push('category_id = ?')
      values.push(cmd.category_id)
    }
    if (cmd.date !== undefined) {
      setClauses.push('date = ?')
      values.push(cmd.date)
    }
    if (cmd.is_recurring !== undefined) {
      setClauses.push('is_recurring = ?')
      values.push(cmd.is_recurring ? 1 : 0)
    }
    if (cmd.is_unnecessary !== undefined) {
      setClauses.push('is_unnecessary = ?')
      values.push(cmd.is_unnecessary ? 1 : 0)
    }
    if (cmd.member_id !== undefined) {
      setClauses.push('member_id = ?')
      values.push(cmd.member_id)
    }
    if (cmd.notes !== undefined) {
      setClauses.push('notes = ?')
      values.push(cmd.notes)
    }
    
    setClauses.push('hmac = ?')
    values.push(hmac)
    values.push(cmd.id)
    
    db.prepare(`UPDATE transactions SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
    
    // Append event
    appendEvent(cmd.id, TransactionEventType.UPDATED, {
      ...updates,
      previous_values: previousValues
    })
    
    return true
  })
  
  return tx(command)
}

/**
 * Command: Delete a transaction
 */
export function deleteTransaction(id: number): boolean {
  const db = getDatabase()
  
  const tx = db.transaction((txId: number) => {
    // Check if exists
    const exists = db.prepare('SELECT id FROM transactions WHERE id = ?').get(txId)
    if (!exists) {
      return false
    }
    
    // Delete from materialized view
    db.prepare('DELETE FROM transactions WHERE id = ?').run(txId)
    
    // Append event
    appendEvent(txId, TransactionEventType.DELETED, {})
    
    return true
  })
  
  return tx(id)
}

/**
 * Command: Flag transaction as unnecessary
 */
export function flagTransaction(id: number): boolean {
  const db = getDatabase()
  
  const tx = db.transaction((txId: number) => {
    db.prepare('UPDATE transactions SET is_unnecessary = 1 WHERE id = ?').run(txId)
    appendEvent(txId, TransactionEventType.FLAGGED, { is_unnecessary: true })
    return true
  })
  
  return tx(id)
}

/**
 * Command: Unflag transaction
 */
export function unflagTransaction(id: number): boolean {
  const db = getDatabase()
  
  const tx = db.transaction((txId: number) => {
    db.prepare('UPDATE transactions SET is_unnecessary = 0 WHERE id = ?').run(txId)
    appendEvent(txId, TransactionEventType.UNFLAGGED, { is_unnecessary: false })
    return true
  })
  
  return tx(id)
}

/**
 * Command: Recategorize transaction
 */
export function recategorizeTransaction(id: number, categoryId: number | null): boolean {
  const db = getDatabase()
  
  const tx = db.transaction((txId: number, catId: number | null) => {
    // Get current category for event history
    const current = db.prepare('SELECT category_id FROM transactions WHERE id = ?').get(txId) as any
    
    if (!current) {
      return false
    }
    
    db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?').run(catId, txId)
    
    appendEvent(txId, TransactionEventType.RECATEGORIZED, {
      category_id: catId,
      previous_values: { category_id: current.category_id }
    })
    
    return true
  })
  
  return tx(id, categoryId)
}

/**
 * Command: Undo last change to a transaction
 */
export function undoLastChange(id: number): boolean {
  const db = getDatabase()
  
  const tx = db.transaction((txId: number) => {
    // Get the state before the last event
    const previousState = undoLastEvents(txId, 1)
    
    if (!previousState) {
      return false // Nothing to undo
    }
    
    // Recompute HMAC from state
    const hmac = signTransaction({
      description: previousState.description || '',
      amount: previousState.amount || 0,
      type: previousState.type || 'expense',
      account_id: previousState.account_id || null,
      category_id: previousState.category_id || null,
      date: previousState.date || new Date().toISOString().split('T')[0],
      member_id: previousState.member_id || null
    })
    
    // Determine if we need to INSERT (undoing a delete) or UPDATE
    const exists = db.prepare('SELECT id FROM transactions WHERE id = ?').get(txId)
    
    if (!exists) {
      // Undoing a delete – re-insert the row
      db.prepare(`
        INSERT INTO transactions (id, description, amount, type, account_id, category_id, date,
            is_recurring, is_unnecessary, member_id, notes, hmac)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        txId,
        previousState.description,
        previousState.amount,
        previousState.type,
        previousState.account_id,
        previousState.category_id,
        previousState.date,
        previousState.is_recurring ? 1 : 0,
        previousState.is_unnecessary ? 1 : 0,
        previousState.member_id,
        previousState.notes,
        hmac
      )
      
      // Append RESTORED event so subsequent undo operations see the correct latest event
      appendEvent(txId, TransactionEventType.RESTORED, {
        description: previousState.description,
        amount: previousState.amount,
        type: previousState.type,
        account_id: previousState.account_id,
        category_id: previousState.category_id,
        date: previousState.date,
        is_recurring: previousState.is_recurring ?? false,
        is_unnecessary: previousState.is_unnecessary ?? false,
        member_id: previousState.member_id ?? null,
        notes: previousState.notes ?? null
      })
    } else {
      // Normal undo – update existing row
      db.prepare(`
        UPDATE transactions 
        SET description = ?, amount = ?, type = ?, account_id = ?, category_id = ?, date = ?,
            is_recurring = ?, is_unnecessary = ?, member_id = ?, notes = ?, hmac = ?
        WHERE id = ?
      `).run(
        previousState.description,
        previousState.amount,
        previousState.type,
        previousState.account_id,
        previousState.category_id,
        previousState.date,
        previousState.is_recurring ? 1 : 0,
        previousState.is_unnecessary ? 1 : 0,
        previousState.member_id,
        previousState.notes,
        hmac,
        txId
      )
    }
    
    return true
  })
  
  return tx(id)
}

/**
 * Command: Bulk recategorize transactions
 */
export function bulkRecategorizeTransactions(ids: number[], categoryId: number | null): boolean {
  const db = getDatabase()
  
  const tx = db.transaction((txIds: number[], catId: number | null) => {
    for (const id of txIds) {
      recategorizeTransaction(id, catId)
    }
    return true
  })
  
  return tx(ids, categoryId)
}

/**
 * Command: Bulk delete transactions
 */
export function bulkDeleteTransactions(ids: number[]): boolean {
  const db = getDatabase()
  
  const tx = db.transaction((txIds: number[]) => {
    for (const id of txIds) {
      deleteTransaction(id)
    }
    return true
  })
  
  return tx(ids)
}

/**
 * Command: Bulk flag transactions
 */
export function bulkFlagTransactions(ids: number[]): boolean {
  const db = getDatabase()
  
  const tx = db.transaction((txIds: number[]) => {
    for (const id of txIds) {
      flagTransaction(id)
    }
    return true
  })
  
  return tx(ids)
}

/**
 * Command: Import transactions from CSV with event sourcing
 */
export function importTransactionsFromCsvWithEvents(
  rows: Array<{ description: string; amount: number; date: string; type?: string; category_id?: number | null }>,
  accountId?: number | null
): { imported: number; skippedDuplicates: number } {
  const db = getDatabase()
  
  const tx = db.transaction((txRows: Array<{ description: string; amount: number; date: string; type?: string; category_id?: number | null }>, importAccountId?: number | null) => {
    let imported = 0
    let skippedDuplicates = 0
    for (const row of txRows) {
      const type = (row.type === 'income' || row.type === 'transfer') ? row.type : 'expense'
      if (hasDuplicateTransaction({
        description: row.description,
        amount: row.amount,
        type,
        account_id: importAccountId ?? undefined,
        date: row.date
      })) {
        skippedDuplicates++
        continue
      }

      createTransaction({
        description: row.description,
        amount: row.amount,
        type,
        category_id: row.category_id ?? null,
        date: row.date,
        account_id: importAccountId ?? undefined
      })
      imported++
    }
    return { imported, skippedDuplicates }
  })
  
  return tx(rows, accountId)
}

/**
 * Command: Rebuild materialized view from events
 * Useful for recovery or consistency checks
 */
export function rebuildTransactionsProjection(): number {
  const db = getDatabase()
  
  const tx = db.transaction(() => {
    // Get current state from events
    const eventState = replayAllEvents()
    
    // Clear and rebuild transactions table
    db.prepare('DELETE FROM transactions').run()
    
    let count = 0
    for (const [transactionId, state] of eventState.entries()) {
      const hmac = signTransaction({
        description: state.description || '',
        amount: state.amount || 0,
        type: state.type || 'expense',
        account_id: state.account_id || null,
        category_id: state.category_id || null,
        date: state.date || new Date().toISOString().split('T')[0],
        member_id: state.member_id || null
      })
      
      db.prepare(`
        INSERT INTO transactions (
          id, description, amount, type, account_id, category_id, date,
          is_recurring, is_unnecessary, member_id, notes, hmac
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        transactionId,
        state.description,
        state.amount,
        state.type,
        state.account_id,
        state.category_id,
        state.date,
        state.is_recurring ? 1 : 0,
        state.is_unnecessary ? 1 : 0,
        state.member_id,
        state.notes,
        hmac
      )
      
      count++
    }
    
    return count
  })
  
  return tx()
}

// Made with Bob
