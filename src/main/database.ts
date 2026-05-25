import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'

let db: Database.Database | null = null

export function getDbPath(): string {
  const dir = join(app.getPath('appData'), 'BudgetApp')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'data.db')
}

export function initDatabase(): Database.Database {
  if (db) return db
  db = new Database(getDbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

export function getDatabase(): Database.Database {
  if (!db) return initDatabase()
  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

function runMigrations(database: Database.Database): void {
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
      goal_type TEXT
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
      created_at TEXT DEFAULT (datetime('now'))
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

    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
  `)

  // Migration: Update existing transactions table to support savings and transfer types
  try {
    const tableInfo = database.pragma('table_info(transactions)') as Array<{ name: string }>
    if (tableInfo.length > 0) {
      // Check if we need to migrate by trying to insert a savings transaction
      try {
        database.prepare("INSERT INTO transactions (description, amount, type, date) VALUES ('_migration_test_', 0, 'savings', '2024-01-01')").run()
        database.prepare("DELETE FROM transactions WHERE description = '_migration_test_'").run()
      } catch (e) {
        // If insert fails, we need to migrate
        console.log('Migrating transactions table to support savings/transfer types...')
        database.exec(`
          CREATE TABLE transactions_new (
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
            FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
            FOREIGN KEY (member_id) REFERENCES household_members(id) ON DELETE SET NULL
          );

          INSERT INTO transactions_new SELECT * FROM transactions;

          DROP TABLE transactions;

          ALTER TABLE transactions_new RENAME TO transactions;
        `)
        console.log('Migration complete')
      }
    }
  } catch (e) {
    console.log('Migration check skipped:', e)
  }

  // Migration: Add goal_type column to categories and create default categories
  try {
    const categoryColumns = database.pragma('table_info(categories)') as Array<{ name: string }>
    const hasGoalType = categoryColumns.some((c) => c.name === 'goal_type')
    if (!hasGoalType) {
      console.log('Adding goal_type column to categories...')
      database.exec('ALTER TABLE categories ADD COLUMN goal_type TEXT')
      
      // Create default categories with goal types
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
  } catch (e) {
    console.log('Category migration skipped:', e)
  }

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
}
