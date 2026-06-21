import SqlCipher from 'better-sqlite3-multiple-ciphers'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import {
  isKeystoreUnlocked,
  isKeystoreInitialized,
  lockKeystore
} from './crypto/keyManager'
import {
  openEncryptedDatabase,
  createEncryptedDatabase,
  hasEncryptedDatabase,
  needsMigration,
  migrateToEncrypted
} from './db/migration'
import { backfillHMACs } from './crypto/integrity'
import { initializeEventStore } from './events/event-store'

let db: SqlCipher.Database | null = null

export function getDbPath(): string {
  const dir = join(app.getPath('appData'), 'BudgetApp')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'data_encrypted.db')
}

/**
 * Initialize the encrypted database
 * Requires the keystore to be unlocked first
 */
export function initDatabase(): SqlCipher.Database {
  if (db) return db
  
  if (!isKeystoreUnlocked()) {
    throw new Error('Cannot initialize database: keystore is locked')
  }
  
  // Check if we need to create a new database or open existing
  if (hasEncryptedDatabase()) {
    db = openEncryptedDatabase()
  } else {
    db = createEncryptedDatabase()
  }
  
  // Run migrations to ensure schema is up to date
  runMigrations(db)
  
  // Initialize event sourcing tables
  initializeEventStore()
  
  return db
}

/**
 * Get the database instance
 * Throws if database is not initialized
 */
export function getDatabase(): SqlCipher.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

/**
 * Close the database and lock the keystore
 */
export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
  lockKeystore()
}

/**
 * Check if database is initialized
 */
export function isDatabaseInitialized(): boolean {
  return db !== null
}

/**
 * Check if encryption setup is required
 */
export function requiresEncryptionSetup(): boolean {
  return !isKeystoreInitialized()
}

/**
 * Check if migration from unencrypted DB is needed
 */
export function requiresMigration(): boolean {
  return needsMigration()
}

/**
 * Perform migration from unencrypted to encrypted database
 */
export async function performMigration(): Promise<void> {
  if (!isKeystoreUnlocked()) {
    throw new Error('Keystore must be unlocked before migration')
  }
  
  await migrateToEncrypted()
  
  // Initialize the newly migrated database
  if (db) {
    db.close()
    db = null
  }
  
  db = openEncryptedDatabase()
  
  // Backfill HMAC signatures for existing data
  console.log('Backfilling HMAC signatures...')
  const results = backfillHMACs()
  console.log('HMAC backfill complete:', results)
}

/**
 * Run database migrations to ensure schema is up to date
 */
function runMigrations(database: SqlCipher.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS household_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#6366f1'
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT DEFAULT 'wallet',
      color TEXT DEFAULT '#6366f1',
      is_fixed INTEGER DEFAULT 0,
      budget_amount REAL DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      goal_type TEXT,
      hmac TEXT
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('expense', 'income', 'savings', 'transfer')),
      category_id INTEGER,
      date TEXT NOT NULL,
      is_recurring INTEGER DEFAULT 0,
      is_unnecessary INTEGER DEFAULT 0,
      member_id INTEGER,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      hmac TEXT,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
      FOREIGN KEY (member_id) REFERENCES household_members(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS budget_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      amount REAL NOT NULL,
      notes TEXT,
      hmac TEXT,
      UNIQUE(category_id, year, month),
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      target_amount REAL NOT NULL,
      current_amount REAL DEFAULT 0,
      target_date TEXT,
      interest_rate REAL,
      monthly_payment REAL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      hmac TEXT
    );

    CREATE TABLE IF NOT EXISTS wealth_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      assets_savings REAL DEFAULT 0,
      assets_investments REAL DEFAULT 0,
      assets_property REAL DEFAULT 0,
      liabilities_loans REAL DEFAULT 0,
      liabilities_credit REAL DEFAULT 0,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS investments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      purchase_price REAL NOT NULL,
      current_value REAL NOT NULL,
      purchase_date TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS investment_holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      etf_name TEXT NOT NULL,
      ticker TEXT,
      shares REAL NOT NULL,
      avg_cost REAL NOT NULL,
      current_price REAL,
      current_value REAL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      frequency TEXT DEFAULT 'monthly',
      next_billing_date TEXT,
      website_url TEXT,
      icon TEXT DEFAULT 'credit-card',
      color TEXT DEFAULT '#8b5cf6',
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS income_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      is_gross INTEGER DEFAULT 0,
      gross_or_net TEXT DEFAULT 'net',
      is_recurring INTEGER DEFAULT 1,
      frequency TEXT DEFAULT 'monthly',
      color TEXT DEFAULT '#22c55e'
    );

    CREATE TABLE IF NOT EXISTS income_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      amount REAL NOT NULL,
      is_irregular INTEGER DEFAULT 0,
      UNIQUE(source_id, year, month),
      FOREIGN KEY (source_id) REFERENCES income_sources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS monthly_mood (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      emoji TEXT,
      UNIQUE(year, month)
    );

    CREATE TABLE IF NOT EXISTS ai_insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      year INTEGER,
      month INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS currency_cache (
      base TEXT PRIMARY KEY,
      rates TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS integrity_warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      detected_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
    CREATE INDEX IF NOT EXISTS idx_integrity_warnings_table ON integrity_warnings(table_name);
  `)

  // Add HMAC columns if they don't exist (for databases created before HMAC was added)
  try {
    const tables = ['transactions', 'budget_entries', 'goals', 'categories']
    for (const table of tables) {
      const columns = database.pragma(`table_info(${table})`) as Array<{ name: string }>
      const hasHMAC = columns.some(c => c.name === 'hmac')
      if (!hasHMAC) {
        database.exec(`ALTER TABLE ${table} ADD COLUMN hmac TEXT`)
        console.log(`Added HMAC column to ${table}`)
      }
    }
  } catch (error) {
    console.log('HMAC column migration check:', error)
  }

  // Ensure default settings exist
  const onboardingDone = database
    .prepare("SELECT value FROM settings WHERE key = 'onboardingComplete'")
    .get() as { value: string } | undefined

  if (!onboardingDone) {
    database
      .prepare(
        `INSERT OR IGNORE INTO settings (key, value) VALUES
        ('profile', '{"name":"","currency":"SEK","displayCurrency":"SEK","cpiPercent":2.5,"taxWithheldPercent":30,"theme":"system","year":${new Date().getFullYear()},"autoHideZeroCategories":false,"notificationsEnabled":true,"grossIncomeToggle":false}'),
        ('spendingStreak', '{"current":0,"longest":0,"lastDate":null}')`
      )
      .run()
  }

  // Create default categories with goal types if they don't exist
  const categoryCount = database.prepare('SELECT COUNT(*) as count FROM categories').get() as { count: number }
  
  if (categoryCount.count === 0) {
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
    console.log('Default categories created')
  }
}

// Made with Bob
