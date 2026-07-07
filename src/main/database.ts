import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'

let db: Database.Database | null = null

function getProfileDefaults(): Record<string, unknown> {
  return {
    name: '',
    currency: 'SEK',
    displayCurrency: 'SEK',
    baseCurrency: 'SEK',
    cpiPercent: 2.5,
    taxWithheldPercent: 30,
    theme: 'system',
    year: new Date().getFullYear(),
    autoHideZeroCategories: false,
    notificationsEnabled: true,
    grossIncomeToggle: false,
    savingsRateTarget: 20,
    colorBlindMode: false,
    locale: 'sv-SE'
  }
}

function backfillProfileDefaults(database: Database.Database): void {
  const row = database.prepare("SELECT value FROM settings WHERE key = 'profile'").get() as
    | { value: string }
    | undefined
  if (!row) return

  try {
    const profile = JSON.parse(row.value) as Record<string, unknown>
    let changed = false
    for (const [key, value] of Object.entries(getProfileDefaults())) {
      if (!(key in profile)) {
        profile[key] = value
        changed = true
      }
    }

    if (changed) {
      database
        .prepare("UPDATE settings SET value = ? WHERE key = 'profile'")
        .run(JSON.stringify(profile))
    }
  } catch (e) {
    console.log('Profile defaults backfill skipped:', e)
  }
}

export const __databaseTesting = {
  getProfileDefaults,
  backfillProfileDefaults
}

function ensureMainAccount(database: Database.Database): number {
  database.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('checking', 'savings', 'cash', 'other')) DEFAULT 'checking',
      currency TEXT NOT NULL DEFAULT 'SEK',
      is_archived INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)

  const existing = database
    .prepare("SELECT id FROM accounts WHERE is_archived = 0 ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined
  if (existing) return existing.id

  const result = database
    .prepare("INSERT INTO accounts (name, type, currency, is_archived) VALUES ('Main', 'checking', 'SEK', 0)")
    .run()
  return Number(result.lastInsertRowid)
}

function addColumnIfMissing(database: Database.Database, table: string, column: string, definition: string): boolean {
  const columns = database.pragma(`table_info(${table})`) as Array<{ name: string }>
  if (columns.some((c) => c.name === column)) return false
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`)
  return true
}

function runAccountMigration(database: Database.Database): void {
  try {
    const mainAccountId = ensureMainAccount(database)
    addColumnIfMissing(database, 'transactions', 'account_id', 'account_id INTEGER')
    addColumnIfMissing(database, 'subscriptions', 'account_id', 'account_id INTEGER')
    addColumnIfMissing(database, 'savings_sources', 'account_id', 'account_id INTEGER')
    addColumnIfMissing(database, 'income_sources', 'account_id', 'account_id INTEGER')

    database.prepare('UPDATE transactions SET account_id = ? WHERE account_id IS NULL').run(mainAccountId)
    database.prepare('UPDATE subscriptions SET account_id = ? WHERE account_id IS NULL').run(mainAccountId)
    database.prepare('UPDATE savings_sources SET account_id = ? WHERE account_id IS NULL').run(mainAccountId)
    database.prepare('UPDATE income_sources SET account_id = ? WHERE account_id IS NULL').run(mainAccountId)

    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_date_id ON transactions(date DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions(account_id, date DESC);
      CREATE INDEX IF NOT EXISTS idx_transactions_category_date ON transactions(category_id, date DESC);
      CREATE INDEX IF NOT EXISTS idx_transactions_type_date ON transactions(type, date DESC);
      CREATE INDEX IF NOT EXISTS idx_transactions_flagged_date ON transactions(is_unnecessary, date DESC);
      CREATE INDEX IF NOT EXISTS idx_transactions_recurring_date ON transactions(is_recurring, date DESC);
      CREATE INDEX IF NOT EXISTS idx_transactions_description ON transactions(description COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_account ON subscriptions(account_id);
    `)
  } catch (e) {
    console.log('Accounts migration skipped:', e)
  }
}

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

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('checking', 'savings', 'cash', 'other')) DEFAULT 'checking',
      currency TEXT NOT NULL DEFAULT 'SEK',
      is_archived INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('expense', 'income', 'savings', 'transfer')),
      account_id INTEGER,
      category_id INTEGER,
      date TEXT NOT NULL,
      is_recurring INTEGER DEFAULT 0,
      is_unnecessary INTEGER DEFAULT 0,
      member_id INTEGER,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
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
      notes TEXT,
      account_id INTEGER,
      transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS income_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      is_gross INTEGER DEFAULT 0,
      gross_or_net TEXT DEFAULT 'net',
      is_recurring INTEGER DEFAULT 1,
      frequency TEXT DEFAULT 'monthly',
      account_id INTEGER,
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

    CREATE TABLE IF NOT EXISTS tax_estimates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
      income_gross REAL NOT NULL DEFAULT 0,
      income_net_actual REAL NOT NULL DEFAULT 0,
      supposed_net_income REAL NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(year, month)
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

    CREATE TABLE IF NOT EXISTS savings_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      is_recurring INTEGER DEFAULT 1,
      frequency TEXT DEFAULT 'monthly',
      category_id INTEGER,
      account_id INTEGER,
      transaction_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_date_id ON transactions(date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_category_date ON transactions(category_id, date DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_type_date ON transactions(type, date DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_flagged_date ON transactions(is_unnecessary, date DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_recurring_date ON transactions(is_recurring, date DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_description ON transactions(description COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_tax_estimates_year_month ON tax_estimates(year, month);
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
            account_id INTEGER,
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

          INSERT INTO transactions_new (
            id, description, amount, type, category_id, date, is_recurring, is_unnecessary, member_id, notes, created_at
          )
          SELECT id, description, amount, type, category_id, date, is_recurring, is_unnecessary, member_id, notes, created_at FROM transactions;

          DROP TABLE transactions;

          ALTER TABLE transactions_new RENAME TO transactions;
        `)
        console.log('Migration complete')
      }
    }
  } catch (e) {
    console.log('Migration check skipped:', e)
  }

  runAccountMigration(database)

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

  // Migration: Add is_recurring column to income_sources
  try {
    const incomeSourceColumns = database.pragma('table_info(income_sources)') as Array<{ name: string }>
    const hasIsRecurring = incomeSourceColumns.some((c) => c.name === 'is_recurring')
    if (!hasIsRecurring) {
      console.log('Adding is_recurring column to income_sources...')
      database.exec('ALTER TABLE income_sources ADD COLUMN is_recurring INTEGER DEFAULT 1')
      console.log('is_recurring column added')
    }
  } catch (e) {
    console.log('Income sources migration skipped:', e)
  }

  // Migration: Add transaction_id column to subscriptions
  try {
    const subColumns = database.pragma('table_info(subscriptions)') as Array<{ name: string }>
    if (!subColumns.some((c) => c.name === 'transaction_id')) {
      console.log('Adding transaction_id column to subscriptions...')
      database.exec('ALTER TABLE subscriptions ADD COLUMN transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL')
      console.log('transaction_id column added to subscriptions')
    }
  } catch (e) {
    console.log('Subscriptions transaction_id migration skipped:', e)
  }

  // Migration: Add tax_deductible column to subscriptions
  try {
    const subColumns = database.pragma('table_info(subscriptions)') as Array<{ name: string }>
    if (!subColumns.some((c) => c.name === 'tax_deductible')) {
      console.log('Adding tax_deductible column to subscriptions...')
      database.exec('ALTER TABLE subscriptions ADD COLUMN tax_deductible INTEGER DEFAULT 0')
    }
  } catch (e) {
    console.log('Subscriptions tax_deductible migration skipped:', e)
  }

  // Migration: Add on_hold column to subscriptions
  try {
    const subColumns = database.pragma('table_info(subscriptions)') as Array<{ name: string }>
    if (!subColumns.some((c) => c.name === 'on_hold')) {
      console.log('Adding on_hold column to subscriptions...')
      database.exec('ALTER TABLE subscriptions ADD COLUMN on_hold INTEGER DEFAULT 0')
    }
  } catch (e) {
    console.log('Subscriptions on_hold migration skipped:', e)
  }

  try {
    const incomeSourceColumns = database.pragma('table_info(income_sources)') as Array<{ name: string }>
    const hasGrossOrNet = incomeSourceColumns.some((c) => c.name === 'gross_or_net')
    const hasFrequency = incomeSourceColumns.some((c) => c.name === 'frequency')
    if (!hasGrossOrNet) {
      database.exec("ALTER TABLE income_sources ADD COLUMN gross_or_net TEXT DEFAULT 'net'")
      database.exec(
        "UPDATE income_sources SET gross_or_net = CASE WHEN is_gross = 1 THEN 'gross' ELSE 'net' END WHERE gross_or_net IS NULL"
      )
    }
    if (!hasFrequency) {
      database.exec("ALTER TABLE income_sources ADD COLUMN frequency TEXT DEFAULT 'monthly'")
      database.exec("UPDATE income_sources SET frequency = 'monthly' WHERE frequency IS NULL OR frequency = ''")
    }
  } catch (e) {
    console.log('Income source gross/net/frequency migration skipped:', e)
  }

  // Migration: Drop ai_summary columns from goals (reverted feature)
  try {
    const goalColumns = database.pragma('table_info(goals)') as Array<{ name: string }>
    if (goalColumns.some((c) => c.name === 'ai_summary')) {
      console.log('Dropping ai_summary columns from goals...')
      database.exec('ALTER TABLE goals DROP COLUMN ai_summary')
      database.exec('ALTER TABLE goals DROP COLUMN ai_summary_updated')
    }
  } catch (e) {
    console.log('Goals ai_summary drop migration skipped:', e)
  }

  // Migration: Create categorization_rules table
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS categorization_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT NOT NULL,
        category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        priority INTEGER DEFAULT 100,
        apply_future_only INTEGER DEFAULT 0,
        conditions_json TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `)
    addColumnIfMissing(database, 'categorization_rules', 'priority', 'priority INTEGER DEFAULT 100')
    addColumnIfMissing(database, 'categorization_rules', 'apply_future_only', 'apply_future_only INTEGER DEFAULT 0')
    addColumnIfMissing(database, 'categorization_rules', 'conditions_json', 'conditions_json TEXT')
  } catch (e) {
    console.log('Categorization rules migration skipped:', e)
  }

  const onboardingDone = database
    .prepare("SELECT value FROM settings WHERE key = 'onboardingComplete'")
    .get() as { value: string } | undefined

  if (!onboardingDone) {
    database
      .prepare(
        `INSERT OR IGNORE INTO settings (key, value) VALUES
        ('profile', '${JSON.stringify(getProfileDefaults())}'),
        ('spendingStreak', '{"current":0,"longest":0,"lastDate":null}')`
      )
      .run()
  }
  backfillProfileDefaults(database)
}
