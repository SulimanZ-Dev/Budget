import { describe, expect, it } from 'vitest'
import { runFinancialToolsMigration } from '../financial-tools-schema'

class FakeSchemaDatabase {
  statements: string[] = []
  columns = new Map<string, Set<string>>([
    ['transactions', new Set(['id'])],
    ['goals', new Set(['id'])]
  ])

  pragma(source: string): Array<{ name: string }> {
    const table = source.match(/table_info\(([^)]+)\)/)?.[1] ?? ''
    return [...(this.columns.get(table) ?? [])].map((name) => ({ name }))
  }

  exec(sql: string): void {
    this.statements.push(sql)
    const alter = sql.match(/ALTER TABLE (\w+) ADD COLUMN (\w+)/)
    if (alter) {
      const [, table, column] = alter
      if (!this.columns.has(table)) this.columns.set(table, new Set())
      this.columns.get(table)!.add(column)
    }
    if (sql.includes('CREATE TABLE IF NOT EXISTS debt_payments')) {
      this.columns.set('debt_payments', new Set(['id', 'goal_id', 'amount', 'payment_date', 'note', 'transaction_id', 'principal_amount', 'interest_amount', 'fee_amount', 'created_at']))
    }
  }
}

describe('financial tools schema', () => {
  it('adds review, import, scenario, and debt-linking structures idempotently', () => {
    const database = new FakeSchemaDatabase()
    runFinancialToolsMigration(database)
    const firstAlterCount = database.statements.filter((sql) => sql.startsWith('ALTER TABLE')).length
    runFinancialToolsMigration(database)

    const sql = database.statements.join('\n')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS review_dismissals')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS import_profiles')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS import_sessions')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS financial_scenarios')
    expect(sql).toContain('idx_debt_payments_transaction')
    expect(sql).toContain('UPDATE debt_payments SET principal_amount=amount')
    expect(database.statements.filter((statement) => statement.startsWith('ALTER TABLE'))).toHaveLength(firstAlterCount)
  })
})
