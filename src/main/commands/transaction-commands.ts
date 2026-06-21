import { getDatabase } from '../database-encrypted'
import { signTransaction } from '../crypto/integrity'
import { 
  appendEvent, 
  TransactionEventType, 
  TransactionEventPayload,
  replayTransactionEvents
} from '../events/event-store'

/**
 * Command: Create a new transaction
 */
export interface CreateTransactionCommand {
  description: string
  amount: number
  type: 'expense' | 'income' | 'savings' | 'transfer'
  category_id?: number | null
  date: string
  is_recurring?: boolean
  is_unnecessary?: boolean
  member_id?: number | null
  notes?: string | null
}

export function createTransaction(command: CreateTransactionCommand): { id: number } {
  const db = getDatabase()
  
  // Compute HMAC for the transaction
  const hmac = signTransaction({
    description: command.description,
    amount: command.amount,
    type: command.type,
    category_id: command.category_id ?? null,
    date: command.date,
    member_id: command.member_id ?? null
  })
  
  // Insert into materialized view (transactions table)
  const result = db.prepare(`
    INSERT INTO transactions (
      description, amount, type, category_id, date, 
      is_recurring, is_unnecessary, member_id, notes, hmac
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    command.description,
    command.amount,
    command.type,
    command.category_id ?? null,
    command.date,
    command.is_recurring ? 1 : 0,
    command.is_unnecessary ? 1 : 0,
    command.member_id ?? null,
    command.notes ?? null,
    hmac
  )
  
  const transactionId = Number(result.lastInsertRowid)
  
  // Append event to event store
  appendEvent(transactionId, TransactionEventType.CREATED, {
    description: command.description,
    amount: command.amount,
    type: command.type,
    category_id: command.category_id ?? null,
    date: command.date,
    is_recurring: command.is_recurring ?? false,
    is_unnecessary: command.is_unnecessary ?? false,
    member_id: command.member_id ?? null,
    notes: command.notes ?? null
  })
  
  return { id: transactionId }
}

/**
 * Command: Update an existing transaction
 */
export interface UpdateTransactionCommand {
  id: number
  description?: string
  amount?: number
  type?: 'expense' | 'income' | 'savings' | 'transfer'
  category_id?: number | null
  date?: string
  is_recurring?: boolean
  is_unnecessary?: boolean
  member_id?: number | null
  notes?: string | null
}

export function updateTransaction(command: UpdateTransactionCommand): boolean {
  const db = getDatabase()
  
  // Get current state for event history
  const current = db.prepare('SELECT * FROM transactions WHERE id = ?').get(command.id) as any
  
  if (!current) {
    throw new Error(`Transaction ${command.id} not found`)
  }
  
  // Build update payload with only changed fields
  const updates: Partial<CreateTransactionCommand> = {}
  const previousValues: Partial<CreateTransactionCommand> = {}
  
  if (command.description !== undefined && command.description !== current.description) {
    updates.description = command.description
    previousValues.description = current.description
  }
  if (command.amount !== undefined && command.amount !== current.amount) {
    updates.amount = command.amount
    previousValues.amount = current.amount
  }
  if (command.type !== undefined && command.type !== current.type) {
    updates.type = command.type
    previousValues.type = current.type
  }
  if (command.category_id !== undefined && command.category_id !== current.category_id) {
    updates.category_id = command.category_id
    previousValues.category_id = current.category_id
  }
  if (command.date !== undefined && command.date !== current.date) {
    updates.date = command.date
    previousValues.date = current.date
  }
  if (command.is_recurring !== undefined && (command.is_recurring ? 1 : 0) !== current.is_recurring) {
    updates.is_recurring = command.is_recurring
    previousValues.is_recurring = current.is_recurring === 1
  }
  if (command.is_unnecessary !== undefined && (command.is_unnecessary ? 1 : 0) !== current.is_unnecessary) {
    updates.is_unnecessary = command.is_unnecessary
    previousValues.is_unnecessary = current.is_unnecessary === 1
  }
  if (command.member_id !== undefined && command.member_id !== current.member_id) {
    updates.member_id = command.member_id
    previousValues.member_id = current.member_id
  }
  if (command.notes !== undefined && command.notes !== current.notes) {
    updates.notes = command.notes
    previousValues.notes = current.notes
  }
  
  if (Object.keys(updates).length === 0) {
    return true // No changes
  }
  
  // Compute new HMAC
  const hmac = signTransaction({
    description: command.description ?? current.description,
    amount: command.amount ?? current.amount,
    type: command.type ?? current.type,
    category_id: command.category_id !== undefined ? command.category_id : current.category_id,
    date: command.date ?? current.date,
    member_id: command.member_id !== undefined ? command.member_id : current.member_id
  })
  
  // Update materialized view
  const setClauses: string[] = []
  const values: any[] = []
  
  if (command.description !== undefined) {
    setClauses.push('description = ?')
    values.push(command.description)
  }
  if (command.amount !== undefined) {
    setClauses.push('amount = ?')
    values.push(command.amount)
  }
  if (command.type !== undefined) {
    setClauses.push('type = ?')
    values.push(command.type)
  }
  if (command.category_id !== undefined) {
    setClauses.push('category_id = ?')
    values.push(command.category_id)
  }
  if (command.date !== undefined) {
    setClauses.push('date = ?')
    values.push(command.date)
  }
  if (command.is_recurring !== undefined) {
    setClauses.push('is_recurring = ?')
    values.push(command.is_recurring ? 1 : 0)
  }
  if (command.is_unnecessary !== undefined) {
    setClauses.push('is_unnecessary = ?')
    values.push(command.is_unnecessary ? 1 : 0)
  }
  if (command.member_id !== undefined) {
    setClauses.push('member_id = ?')
    values.push(command.member_id)
  }
  if (command.notes !== undefined) {
    setClauses.push('notes = ?')
    values.push(command.notes)
  }
  
  setClauses.push('hmac = ?')
  values.push(hmac)
  values.push(command.id)
  
  db.prepare(`UPDATE transactions SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
  
  // Append event
  appendEvent(command.id, TransactionEventType.UPDATED, {
    ...updates,
    previous_values: previousValues
  })
  
  return true
}

/**
 * Command: Delete a transaction
 */
export function deleteTransaction(id: number): boolean {
  const db = getDatabase()
  
  // Check if exists
  const exists = db.prepare('SELECT id FROM transactions WHERE id = ?').get(id)
  if (!exists) {
    return false
  }
  
  // Delete from materialized view
  db.prepare('DELETE FROM transactions WHERE id = ?').run(id)
  
  // Append event
  appendEvent(id, TransactionEventType.DELETED, {})
  
  return true
}

/**
 * Command: Flag transaction as unnecessary
 */
export function flagTransaction(id: number): boolean {
  const db = getDatabase()
  
  db.prepare('UPDATE transactions SET is_unnecessary = 1 WHERE id = ?').run(id)
  appendEvent(id, TransactionEventType.FLAGGED, { is_unnecessary: true })
  
  return true
}

/**
 * Command: Unflag transaction
 */
export function unflagTransaction(id: number): boolean {
  const db = getDatabase()
  
  db.prepare('UPDATE transactions SET is_unnecessary = 0 WHERE id = ?').run(id)
  appendEvent(id, TransactionEventType.UNFLAGGED, { is_unnecessary: false })
  
  return true
}

/**
 * Command: Recategorize transaction
 */
export function recategorizeTransaction(id: number, categoryId: number | null): boolean {
  const db = getDatabase()
  
  // Get current category for event history
  const current = db.prepare('SELECT category_id FROM transactions WHERE id = ?').get(id) as any
  
  if (!current) {
    return false
  }
  
  db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?').run(categoryId, id)
  
  appendEvent(id, TransactionEventType.RECATEGORIZED, {
    category_id: categoryId,
    previous_values: { category_id: current.category_id }
  })
  
  return true
}

/**
 * Command: Undo last change to a transaction
 */
export function undoLastChange(id: number): boolean {
  const db = getDatabase()
  
  // Get the state before the last event
  const { undoLastEvents } = require('../events/event-store')
  const previousState = undoLastEvents(id, 1)
  
  if (!previousState) {
    return false // Nothing to undo or transaction would be deleted
  }
  
  // Recompute HMAC
  const hmac = signTransaction({
    description: previousState.description || '',
    amount: previousState.amount || 0,
    type: previousState.type || 'expense',
    category_id: previousState.category_id || null,
    date: previousState.date || new Date().toISOString().split('T')[0],
    member_id: previousState.member_id || null
  })
  
  // Update materialized view to previous state
  db.prepare(`
    UPDATE transactions 
    SET description = ?, amount = ?, type = ?, category_id = ?, date = ?,
        is_recurring = ?, is_unnecessary = ?, member_id = ?, notes = ?, hmac = ?
    WHERE id = ?
  `).run(
    previousState.description,
    previousState.amount,
    previousState.type,
    previousState.category_id,
    previousState.date,
    previousState.is_recurring ? 1 : 0,
    previousState.is_unnecessary ? 1 : 0,
    previousState.member_id,
    previousState.notes,
    hmac,
    id
  )
  
  return true
}

/**
 * Command: Bulk recategorize transactions
 */
export function bulkRecategorizeTransactions(ids: number[], categoryId: number | null): boolean {
  const db = getDatabase()
  
  for (const id of ids) {
    recategorizeTransaction(id, categoryId)
  }
  
  return true
}

/**
 * Command: Bulk delete transactions
 */
export function bulkDeleteTransactions(ids: number[]): boolean {
  const db = getDatabase()
  
  for (const id of ids) {
    deleteTransaction(id)
  }
  
  return true
}

/**
 * Command: Bulk flag transactions
 */
export function bulkFlagTransactions(ids: number[]): boolean {
  const db = getDatabase()
  
  for (const id of ids) {
    flagTransaction(id)
  }
  
  return true
}

/**
 * Command: Import transactions from CSV with event sourcing
 */
export function importTransactionsFromCsvWithEvents(
  rows: Array<{ description: string; amount: number; date: string }>
): { imported: number } {
  const db = getDatabase()
  
  let imported = 0
  for (const row of rows) {
    createTransaction({
      description: row.description,
      amount: row.amount,
      type: 'expense',
      date: row.date
    })
    imported++
  }
  
  return { imported }
}

/**
 * Command: Rebuild materialized view from events
 * Useful for recovery or consistency checks
 */
export function rebuildTransactionsProjection(): number {
  const db = getDatabase()
  const { replayAllEvents } = require('../events/event-store')
  
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
      category_id: state.category_id || null,
      date: state.date || new Date().toISOString().split('T')[0],
      member_id: state.member_id || null
    })
    
    db.prepare(`
      INSERT INTO transactions (
        id, description, amount, type, category_id, date,
        is_recurring, is_unnecessary, member_id, notes, hmac
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      transactionId,
      state.description,
      state.amount,
      state.type,
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
}

// Made with Bob
