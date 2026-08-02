interface SchemaDatabase {
  exec(sql: string): unknown
  pragma(source: string): unknown
}

function addColumnIfMissing(
  database: SchemaDatabase,
  table: string,
  column: string,
  definition: string
): void {
  const columns = database.pragma(`table_info(${table})`) as Array<{ name: string }>
  if (!columns.some((item) => item.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`)
  }
}

export function runFinancialToolsMigration(database: SchemaDatabase): void {
  addColumnIfMissing(database, 'transactions', 'reconciled', 'reconciled INTEGER DEFAULT 0')
  addColumnIfMissing(database, 'transactions', 'reconciled_at', 'reconciled_at TEXT')
  addColumnIfMissing(database, 'transactions', 'merchant_name', 'merchant_name TEXT')
  addColumnIfMissing(database, 'goals', 'creditor', 'creditor TEXT')
  addColumnIfMissing(database, 'goals', 'next_payment_date', 'next_payment_date TEXT')

  database.exec(`
    CREATE TABLE IF NOT EXISTS transaction_splits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      amount REAL NOT NULL CHECK(amount > 0),
      UNIQUE(transaction_id, category_id)
    );

    CREATE TABLE IF NOT EXISTS transaction_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      mime_type TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      color TEXT DEFAULT '#64748b'
    );

    CREATE TABLE IF NOT EXISTS transaction_tags (
      transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY(transaction_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS transaction_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      linked_transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      link_type TEXT NOT NULL CHECK(link_type IN ('refund')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(source_transaction_id, linked_transaction_id, link_type),
      CHECK(source_transaction_id <> linked_transaction_id)
    );

    CREATE TABLE IF NOT EXISTS shared_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      member_id INTEGER REFERENCES household_members(id) ON DELETE SET NULL,
      person_name TEXT NOT NULL,
      share_amount REAL NOT NULL CHECK(share_amount >= 0),
      settled INTEGER DEFAULT 0,
      UNIQUE(transaction_id, person_name)
    );

    CREATE TABLE IF NOT EXISTS account_reconciliations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      statement_date TEXT NOT NULL,
      statement_balance REAL NOT NULL,
      calculated_balance REAL NOT NULL,
      difference REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(account_id, statement_date)
    );

    CREATE TABLE IF NOT EXISTS budget_rollover (
      category_id INTEGER PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS saved_filters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      filters_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS merchant_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL COLLATE NOCASE UNIQUE,
      merchant_name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS closed_months (
      year INTEGER NOT NULL,
      month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
      closed_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY(year, month)
    );

    CREATE TABLE IF NOT EXISTS debt_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      amount REAL NOT NULL CHECK(amount > 0),
      payment_date TEXT NOT NULL,
      note TEXT,
      transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
      principal_amount REAL,
      interest_amount REAL NOT NULL DEFAULT 0,
      fee_amount REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS review_dismissals (
      item_key TEXT PRIMARY KEY,
      dismissed_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS import_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      mapping_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS import_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER REFERENCES import_profiles(id) ON DELETE SET NULL,
      source_name TEXT,
      imported_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS financial_scenarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      events_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_transaction_splits_transaction ON transaction_splits(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_transaction_splits_category ON transaction_splits(category_id);
    CREATE INDEX IF NOT EXISTS idx_transaction_attachments_transaction ON transaction_attachments(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_transaction_tags_tag ON transaction_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_transaction_links_source ON transaction_links(source_transaction_id);
    CREATE INDEX IF NOT EXISTS idx_transaction_links_linked ON transaction_links(linked_transaction_id);
    CREATE INDEX IF NOT EXISTS idx_shared_expenses_transaction ON shared_expenses(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_reconciled ON transactions(reconciled, date);
    CREATE INDEX IF NOT EXISTS idx_transactions_merchant ON transactions(merchant_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_debt_payments_goal_date ON debt_payments(goal_id, payment_date DESC);
    CREATE INDEX IF NOT EXISTS idx_import_sessions_created ON import_sessions(created_at DESC);

    CREATE VIEW IF NOT EXISTS transaction_category_amounts AS
      SELECT t.id AS transaction_id, t.date, t.type, t.account_id, t.member_id,
             s.category_id, s.amount
      FROM transactions t
      INNER JOIN transaction_splits s ON s.transaction_id = t.id
      UNION ALL
      SELECT t.id AS transaction_id, t.date, t.type, t.account_id, t.member_id,
             t.category_id, t.amount
      FROM transactions t
      WHERE NOT EXISTS (
        SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id
      );
  `)

  addColumnIfMissing(database, 'debt_payments', 'transaction_id', 'transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL')
  addColumnIfMissing(database, 'debt_payments', 'principal_amount', 'principal_amount REAL')
  addColumnIfMissing(database, 'debt_payments', 'interest_amount', 'interest_amount REAL NOT NULL DEFAULT 0')
  addColumnIfMissing(database, 'debt_payments', 'fee_amount', 'fee_amount REAL NOT NULL DEFAULT 0')
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_debt_payments_transaction ON debt_payments(transaction_id) WHERE transaction_id IS NOT NULL')
  database.exec('UPDATE debt_payments SET principal_amount=amount WHERE principal_amount IS NULL')
}
