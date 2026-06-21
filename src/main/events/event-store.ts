import { getDatabase } from '../database-encrypted'
import { signTransaction } from '../crypto/integrity'

/**
 * Event types for transaction lifecycle
 */
export enum TransactionEventType {
  CREATED = 'CREATED',
  UPDATED = 'UPDATED',
  DELETED = 'DELETED',
  FLAGGED = 'FLAGGED',
  UNFLAGGED = 'UNFLAGGED',
  RECATEGORIZED = 'RECATEGORIZED'
}

/**
 * Event payload structure
 */
export interface TransactionEventPayload {
  description?: string
  amount?: number
  type?: 'expense' | 'income' | 'savings' | 'transfer'
  category_id?: number | null
  date?: string
  is_recurring?: boolean
  is_unnecessary?: boolean
  member_id?: number | null
  notes?: string | null
  // For tracking what changed
  previous_values?: Partial<TransactionEventPayload>
}

/**
 * Event record structure
 */
export interface TransactionEvent {
  event_id: number
  transaction_id: number
  event_type: TransactionEventType
  payload: TransactionEventPayload
  created_at: string
  actor: string // 'user' or 'system'
}

/**
 * Initialize event sourcing tables
 */
export function initializeEventStore(): void {
  const db = getDatabase()
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS transaction_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      actor TEXT DEFAULT 'user',
      hmac TEXT
    );
    
    CREATE INDEX IF NOT EXISTS idx_transaction_events_transaction_id 
      ON transaction_events(transaction_id);
    
    CREATE INDEX IF NOT EXISTS idx_transaction_events_created_at 
      ON transaction_events(created_at DESC);
  `)
}

/**
 * Append an event to the event store
 */
export function appendEvent(
  transactionId: number,
  eventType: TransactionEventType,
  payload: TransactionEventPayload,
  actor: string = 'user'
): number {
  const db = getDatabase()
  
  const payloadJson = JSON.stringify(payload)
  
  // Compute HMAC for event integrity
  const hmac = signTransaction({
    id: transactionId,
    description: payload.description || '',
    amount: payload.amount || 0,
    type: payload.type || 'expense',
    category_id: payload.category_id || null,
    date: payload.date || new Date().toISOString().split('T')[0],
    member_id: payload.member_id || null
  })
  
  const result = db.prepare(`
    INSERT INTO transaction_events (transaction_id, event_type, payload_json, actor, hmac)
    VALUES (?, ?, ?, ?, ?)
  `).run(transactionId, eventType, payloadJson, actor, hmac)
  
  return Number(result.lastInsertRowid)
}

/**
 * Get all events for a specific transaction
 */
export function getTransactionEvents(transactionId: number): TransactionEvent[] {
  const db = getDatabase()
  
  const rows = db.prepare(`
    SELECT event_id, transaction_id, event_type, payload_json, created_at, actor, hmac
    FROM transaction_events
    WHERE transaction_id = ?
    ORDER BY event_id ASC
  `).all(transactionId) as Array<{
    event_id: number
    transaction_id: number
    event_type: string
    payload_json: string
    created_at: string
    actor: string
    hmac: string
  }>
  
  return rows.map(row => ({
    event_id: row.event_id,
    transaction_id: row.transaction_id,
    event_type: row.event_type as TransactionEventType,
    payload: JSON.parse(row.payload_json),
    created_at: row.created_at,
    actor: row.actor
  }))
}

/**
 * Get all events in the system (for full replay)
 */
export function getAllEvents(): TransactionEvent[] {
  const db = getDatabase()
  
  const rows = db.prepare(`
    SELECT event_id, transaction_id, event_type, payload_json, created_at, actor
    FROM transaction_events
    ORDER BY event_id ASC
  `).all() as Array<{
    event_id: number
    transaction_id: number
    event_type: string
    payload_json: string
    created_at: string
    actor: string
  }>
  
  return rows.map(row => ({
    event_id: row.event_id,
    transaction_id: row.transaction_id,
    event_type: row.event_type as TransactionEventType,
    payload: JSON.parse(row.payload_json),
    created_at: row.created_at,
    actor: row.actor
  }))
}

/**
 * Replay events to reconstruct transaction state
 */
export function replayTransactionEvents(transactionId: number): TransactionEventPayload | null {
  const events = getTransactionEvents(transactionId)
  
  if (events.length === 0) {
    return null
  }
  
  let state: TransactionEventPayload | null = null
  
  for (const event of events) {
    switch (event.event_type) {
      case TransactionEventType.CREATED:
        state = { ...event.payload }
        break
        
      case TransactionEventType.UPDATED:
        if (state) {
          state = { ...state, ...event.payload } as TransactionEventPayload
        }
        break
        
      case TransactionEventType.DELETED:
        // Mark as deleted but keep state for history
        if (state) {
          state = { ...state, _deleted: true } as any
        } else {
          state = null
        }
        break
        
      case TransactionEventType.FLAGGED:
        if (state) {
          state.is_unnecessary = true
        }
        break
        
      case TransactionEventType.UNFLAGGED:
        if (state) {
          state.is_unnecessary = false
        }
        break
        
      case TransactionEventType.RECATEGORIZED:
        if (state && event.payload.category_id !== undefined) {
          state.category_id = event.payload.category_id
        }
        break
    }
  }
  
  return state
}

/**
 * Replay all events to rebuild the entire transactions table
 */
export function replayAllEvents(): Map<number, TransactionEventPayload> {
  const events = getAllEvents()
  const transactions = new Map<number, TransactionEventPayload>()
  
  for (const event of events) {
    const currentState = transactions.get(event.transaction_id)
    
    switch (event.event_type) {
      case TransactionEventType.CREATED:
        transactions.set(event.transaction_id, { ...event.payload })
        break
        
      case TransactionEventType.UPDATED:
        if (currentState) {
          transactions.set(event.transaction_id, { ...currentState, ...event.payload })
        }
        break
        
      case TransactionEventType.DELETED:
        transactions.delete(event.transaction_id)
        break
        
      case TransactionEventType.FLAGGED:
        if (currentState) {
          transactions.set(event.transaction_id, { ...currentState, is_unnecessary: true })
        }
        break
        
      case TransactionEventType.UNFLAGGED:
        if (currentState) {
          transactions.set(event.transaction_id, { ...currentState, is_unnecessary: false })
        }
        break
        
      case TransactionEventType.RECATEGORIZED:
        if (currentState && event.payload.category_id !== undefined) {
          transactions.set(event.transaction_id, { 
            ...currentState, 
            category_id: event.payload.category_id 
          })
        }
        break
    }
  }
  
  return transactions
}

/**
 * Undo the last N events for a transaction
 * Returns the new state after undoing
 */
export function undoLastEvents(transactionId: number, count: number = 1): TransactionEventPayload | null {
  const events = getTransactionEvents(transactionId)
  
  if (events.length === 0 || count <= 0) {
    return null
  }
  
  // Replay all events except the last N
  const eventsToReplay = events.slice(0, -count)
  
  if (eventsToReplay.length === 0) {
    return null
  }
  
  let state: TransactionEventPayload | null = null
  
  for (const event of eventsToReplay) {
    switch (event.event_type) {
      case TransactionEventType.CREATED:
        state = { ...event.payload }
        break
        
      case TransactionEventType.UPDATED:
        if (state) {
          state = { ...state, ...event.payload } as TransactionEventPayload
        }
        break
        
      case TransactionEventType.DELETED:
        state = null
        break
        
      case TransactionEventType.FLAGGED:
        if (state) {
          state.is_unnecessary = true
        }
        break
        
      case TransactionEventType.UNFLAGGED:
        if (state) {
          state.is_unnecessary = false
        }
        break
        
      case TransactionEventType.RECATEGORIZED:
        if (state && event.payload.category_id !== undefined) {
          state.category_id = event.payload.category_id
        }
        break
    }
  }
  
  return state
}

/**
 * Get human-readable event history for UI display
 */
export function getTransactionHistory(transactionId: number): Array<{
  event_id: number
  timestamp: string
  action: string
  details: string
  actor: string
}> {
  const events = getTransactionEvents(transactionId)
  
  return events.map(event => {
    let action = ''
    let details = ''
    
    switch (event.event_type) {
      case TransactionEventType.CREATED:
        action = 'Created'
        details = `Amount: ${event.payload.amount} ${event.payload.type}`
        break
        
      case TransactionEventType.UPDATED:
        action = 'Updated'
        const changes: string[] = []
        if (event.payload.amount !== undefined && event.payload.previous_values?.amount !== undefined) {
          changes.push(`Amount: ${event.payload.previous_values.amount} → ${event.payload.amount}`)
        }
        if (event.payload.description !== undefined && event.payload.previous_values?.description !== undefined) {
          changes.push(`Description: "${event.payload.previous_values.description}" → "${event.payload.description}"`)
        }
        if (event.payload.date !== undefined && event.payload.previous_values?.date !== undefined) {
          changes.push(`Date: ${event.payload.previous_values.date} → ${event.payload.date}`)
        }
        details = changes.join(', ') || 'Modified'
        break
        
      case TransactionEventType.DELETED:
        action = 'Deleted'
        details = 'Transaction removed'
        break
        
      case TransactionEventType.FLAGGED:
        action = 'Flagged'
        details = 'Marked as unnecessary'
        break
        
      case TransactionEventType.UNFLAGGED:
        action = 'Unflagged'
        details = 'Unmarked as unnecessary'
        break
        
      case TransactionEventType.RECATEGORIZED:
        action = 'Recategorized'
        details = `Category changed`
        break
    }
    
    return {
      event_id: event.event_id,
      timestamp: event.created_at,
      action,
      details,
      actor: event.actor
    }
  })
}

// Made with Bob
