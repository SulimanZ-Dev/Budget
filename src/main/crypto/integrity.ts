import { createHmac } from 'crypto'
import { deriveKey, isKeystoreUnlocked } from './keyManager'
import { getDatabase } from '../database'

/**
 * Table-specific signing keys derived from the master signing key
 */
const TABLE_SIGNING_KEYS = new Map<string, Buffer>()

/**
 * Get or derive a signing key for a specific table
 */
function getTableSigningKey(tableName: string): Buffer {
  if (!isKeystoreUnlocked()) {
    throw new Error('Keystore must be unlocked before accessing signing keys')
  }
  
  if (!TABLE_SIGNING_KEYS.has(tableName)) {
    const key = deriveKey(`hmac-${tableName}`)
    TABLE_SIGNING_KEYS.set(tableName, key)
  }
  
  return TABLE_SIGNING_KEYS.get(tableName)!
}

/**
 * Clear all cached table signing keys from memory
 */
export function clearTableSigningKeys(): void {
  for (const [, key] of TABLE_SIGNING_KEYS) {
    key.fill(0)
  }
  TABLE_SIGNING_KEYS.clear()
}

/**
 * Compute HMAC-SHA256 signature for a row
 */
function computeHMAC(tableName: string, data: string): string {
  const key = getTableSigningKey(tableName)
  return createHmac('sha256', key).update(data).digest('hex')
}

/**
 * Serialize critical fields from a transaction row for HMAC computation
 */
function serializeTransaction(row: {
  id?: number
  description: string
  amount: number
  type: string
  category_id: number | null
  date: string
  member_id?: number | null
}): string {
  // Include all critical fields that should be tamper-proof
  return JSON.stringify({
    description: row.description,
    amount: row.amount,
    type: row.type,
    category_id: row.category_id,
    date: row.date,
    member_id: row.member_id || null
  })
}

/**
 * Serialize critical fields from a budget entry row
 */
function serializeBudgetEntry(row: {
  category_id: number
  year: number
  month: number
  amount: number
}): string {
  return JSON.stringify({
    category_id: row.category_id,
    year: row.year,
    month: row.month,
    amount: row.amount
  })
}

/**
 * Serialize critical fields from a goal row
 */
function serializeGoal(row: {
  name: string
  type: string
  target_amount: number
  current_amount: number
  target_date?: string | null
}): string {
  return JSON.stringify({
    name: row.name,
    type: row.type,
    target_amount: row.target_amount,
    current_amount: row.current_amount,
    target_date: row.target_date || null
  })
}

/**
 * Serialize critical fields from an account/category row
 */
function serializeCategory(row: {
  name: string
  budget_amount: number
  is_fixed: number
}): string {
  return JSON.stringify({
    name: row.name,
    budget_amount: row.budget_amount,
    is_fixed: row.is_fixed
  })
}

/**
 * Sign a transaction row and return the HMAC
 */
export function signTransaction(row: {
  id?: number
  description: string
  amount: number
  type: string
  category_id: number | null
  date: string
  member_id?: number | null
}): string {
  const data = serializeTransaction(row)
  return computeHMAC('transactions', data)
}

/**
 * Verify a transaction row's HMAC signature
 */
export function verifyTransaction(row: {
  id: number
  description: string
  amount: number
  type: string
  category_id: number | null
  date: string
  member_id?: number | null
  hmac?: string
}): boolean {
  if (!row.hmac) {
    return false
  }
  
  const data = serializeTransaction(row)
  const expectedHMAC = computeHMAC('transactions', data)
  
  return row.hmac === expectedHMAC
}

/**
 * Sign a budget entry row
 */
export function signBudgetEntry(row: {
  category_id: number
  year: number
  month: number
  amount: number
}): string {
  const data = serializeBudgetEntry(row)
  return computeHMAC('budget_entries', data)
}

/**
 * Verify a budget entry row's HMAC signature
 */
export function verifyBudgetEntry(row: {
  category_id: number
  year: number
  month: number
  amount: number
  hmac?: string
}): boolean {
  if (!row.hmac) {
    return false
  }
  
  const data = serializeBudgetEntry(row)
  const expectedHMAC = computeHMAC('budget_entries', data)
  
  return row.hmac === expectedHMAC
}

/**
 * Sign a goal row
 */
export function signGoal(row: {
  name: string
  type: string
  target_amount: number
  current_amount: number
  target_date?: string | null
}): string {
  const data = serializeGoal(row)
  return computeHMAC('goals', data)
}

/**
 * Verify a goal row's HMAC signature
 */
export function verifyGoal(row: {
  name: string
  type: string
  target_amount: number
  current_amount: number
  target_date?: string | null
  hmac?: string
}): boolean {
  if (!row.hmac) {
    return false
  }
  
  const data = serializeGoal(row)
  const expectedHMAC = computeHMAC('goals', data)
  
  return row.hmac === expectedHMAC
}

/**
 * Sign a category row
 */
export function signCategory(row: {
  name: string
  budget_amount: number
  is_fixed: number
}): string {
  const data = serializeCategory(row)
  return computeHMAC('categories', data)
}

/**
 * Verify a category row's HMAC signature
 */
export function verifyCategory(row: {
  name: string
  budget_amount: number
  is_fixed: number
  hmac?: string
}): boolean {
  if (!row.hmac) {
    return false
  }
  
  const data = serializeCategory(row)
  const expectedHMAC = computeHMAC('categories', data)
  
  return row.hmac === expectedHMAC
}

/**
 * Log an integrity warning to the database
 */
export function logIntegrityWarning(
  tableName: string,
  rowId: number,
  reason: string
): void {
  const db = getDatabase()
  
  db.prepare(
    `INSERT INTO integrity_warnings (table_name, row_id, reason, detected_at)
     VALUES (?, ?, ?, datetime('now'))`
  ).run(tableName, rowId, reason)
}

/**
 * Get all integrity warnings
 */
export function getIntegrityWarnings(): Array<{
  id: number
  table_name: string
  row_id: number
  reason: string
  detected_at: string
}> {
  const db = getDatabase()
  return db.prepare('SELECT * FROM integrity_warnings ORDER BY detected_at DESC').all() as Array<{
    id: number
    table_name: string
    row_id: number
    reason: string
    detected_at: string
  }>
}

/**
 * Clear all integrity warnings
 */
export function clearIntegrityWarnings(): void {
  const db = getDatabase()
  db.prepare('DELETE FROM integrity_warnings').run()
}

/**
 * Scan the entire database for integrity violations
 * Returns a summary of findings
 */
export function scanDatabaseIntegrity(): {
  total: number
  verified: number
  failed: number
  missing: number
  tables: Record<string, { verified: number; failed: number; missing: number }>
} {
  const db = getDatabase()
  const results = {
    total: 0,
    verified: 0,
    failed: 0,
    missing: 0,
    tables: {} as Record<string, { verified: number; failed: number; missing: number }>
  }
  
  // Scan transactions
  const transactions = db.prepare('SELECT * FROM transactions').all() as Array<{
    id: number
    description: string
    amount: number
    type: string
    category_id: number | null
    date: string
    member_id: number | null
    hmac?: string
  }>
  
  const txStats = { verified: 0, failed: 0, missing: 0 }
  for (const tx of transactions) {
    results.total++
    if (!tx.hmac) {
      results.missing++
      txStats.missing++
    } else if (verifyTransaction(tx)) {
      results.verified++
      txStats.verified++
    } else {
      results.failed++
      txStats.failed++
      logIntegrityWarning('transactions', tx.id, 'HMAC verification failed')
    }
  }
  results.tables.transactions = txStats
  
  // Scan budget entries
  const budgetEntries = db.prepare('SELECT * FROM budget_entries').all() as Array<{
    id: number
    category_id: number
    year: number
    month: number
    amount: number
    hmac?: string
  }>
  
  const beStats = { verified: 0, failed: 0, missing: 0 }
  for (const entry of budgetEntries) {
    results.total++
    if (!entry.hmac) {
      results.missing++
      beStats.missing++
    } else if (verifyBudgetEntry(entry)) {
      results.verified++
      beStats.verified++
    } else {
      results.failed++
      beStats.failed++
      logIntegrityWarning('budget_entries', entry.id, 'HMAC verification failed')
    }
  }
  results.tables.budget_entries = beStats
  
  // Scan goals
  const goals = db.prepare('SELECT * FROM goals').all() as Array<{
    id: number
    name: string
    type: string
    target_amount: number
    current_amount: number
    target_date: string | null
    hmac?: string
  }>
  
  const goalStats = { verified: 0, failed: 0, missing: 0 }
  for (const goal of goals) {
    results.total++
    if (!goal.hmac) {
      results.missing++
      goalStats.missing++
    } else if (verifyGoal(goal)) {
      results.verified++
      goalStats.verified++
    } else {
      results.failed++
      goalStats.failed++
      logIntegrityWarning('goals', goal.id, 'HMAC verification failed')
    }
  }
  results.tables.goals = goalStats
  
  // Scan categories
  const categories = db.prepare('SELECT * FROM categories').all() as Array<{
    id: number
    name: string
    budget_amount: number
    is_fixed: number
    hmac?: string
  }>
  
  const catStats = { verified: 0, failed: 0, missing: 0 }
  for (const cat of categories) {
    results.total++
    if (!cat.hmac) {
      results.missing++
      catStats.missing++
    } else if (verifyCategory(cat)) {
      results.verified++
      catStats.verified++
    } else {
      results.failed++
      catStats.failed++
      logIntegrityWarning('categories', cat.id, 'HMAC verification failed')
    }
  }
  results.tables.categories = catStats
  
  return results
}

/**
 * Backfill HMAC signatures for existing rows that don't have them
 * This should be run after migration to add HMAC columns
 */
export function backfillHMACs(): {
  transactions: number
  budget_entries: number
  goals: number
  categories: number
} {
  const db = getDatabase()
  const results = {
    transactions: 0,
    budget_entries: 0,
    goals: 0,
    categories: 0
  }
  
  // Backfill transactions
  const transactions = db.prepare('SELECT * FROM transactions WHERE hmac IS NULL').all() as Array<{
    id: number
    description: string
    amount: number
    type: string
    category_id: number | null
    date: string
    member_id: number | null
  }>
  
  const updateTx = db.prepare('UPDATE transactions SET hmac = ? WHERE id = ?')
  for (const tx of transactions) {
    const hmac = signTransaction(tx)
    updateTx.run(hmac, tx.id)
    results.transactions++
  }
  
  // Backfill budget entries
  const budgetEntries = db.prepare('SELECT * FROM budget_entries WHERE hmac IS NULL').all() as Array<{
    id: number
    category_id: number
    year: number
    month: number
    amount: number
  }>
  
  const updateBE = db.prepare('UPDATE budget_entries SET hmac = ? WHERE id = ?')
  for (const entry of budgetEntries) {
    const hmac = signBudgetEntry(entry)
    updateBE.run(hmac, entry.id)
    results.budget_entries++
  }
  
  // Backfill goals
  const goals = db.prepare('SELECT * FROM goals WHERE hmac IS NULL').all() as Array<{
    id: number
    name: string
    type: string
    target_amount: number
    current_amount: number
    target_date: string | null
  }>
  
  const updateGoal = db.prepare('UPDATE goals SET hmac = ? WHERE id = ?')
  for (const goal of goals) {
    const hmac = signGoal(goal)
    updateGoal.run(hmac, goal.id)
    results.goals++
  }
  
  // Backfill categories
  const categories = db.prepare('SELECT * FROM categories WHERE hmac IS NULL').all() as Array<{
    id: number
    name: string
    budget_amount: number
    is_fixed: number
  }>
  
  const updateCat = db.prepare('UPDATE categories SET hmac = ? WHERE id = ?')
  for (const cat of categories) {
    const hmac = signCategory(cat)
    updateCat.run(hmac, cat.id)
    results.categories++
  }
  
  return results
}

// Made with Bob
