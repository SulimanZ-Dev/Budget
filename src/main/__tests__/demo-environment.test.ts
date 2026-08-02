import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const state = vi.hoisted(() => ({
  appData: '',
  existingPaths: new Set<string>(),
  instances: [] as Array<{ path: string; closed: boolean }>
}))

function fakeDatabase(path: string): any {
  const record = { path, closed: false }
  state.instances.push(record)
  return {
    path,
    close: () => { record.closed = true },
    exec: () => undefined,
    pragma: () => [],
    prepare: (sql: string) => ({
      get: () => sql.includes('COUNT(*) as count FROM categories') ? { count: 1 } : undefined,
      all: () => [],
      run: () => ({ lastInsertRowid: 1 })
    }),
    transaction: (operation: (...args: any[]) => unknown) => (...args: any[]) => operation(...args)
  }
}

vi.mock('electron', () => ({
  app: { getPath: () => state.appData }
}))

vi.mock('../crypto/keyManager', () => ({
  isKeystoreUnlocked: () => true,
  isKeystoreInitialized: () => true,
  lockKeystore: vi.fn()
}))

vi.mock('../db/migration', () => ({
  hasEncryptedDatabase: (path: string) => state.existingPaths.has(path),
  createEncryptedDatabase: (path: string) => {
    state.existingPaths.add(path)
    return fakeDatabase(path)
  },
  openEncryptedDatabase: (path: string) => {
    if (!state.existingPaths.has(path)) throw new Error('Database does not exist')
    return fakeDatabase(path)
  },
  needsMigration: () => false,
  migrateToEncrypted: vi.fn()
}))

vi.mock('../crypto/integrity', () => ({
  backfillHMACs: vi.fn(),
  clearTableSigningKeys: vi.fn()
}))

vi.mock('../events/event-store', () => ({ initializeEventStore: vi.fn() }))
vi.mock('../db/financial-tools-schema', () => ({ runFinancialToolsMigration: vi.fn() }))

describe('isolated demo database environment', () => {
  beforeEach(() => {
    state.appData = mkdtempSync(join(tmpdir(), 'budget-demo-environment-'))
    state.existingPaths.clear()
    state.instances.length = 0
    vi.resetModules()
  })

  afterEach(() => {
    if (state.appData && existsSync(state.appData)) {
      rmSync(state.appData, { recursive: true, force: true })
    }
  })

  it('switches to a separate database and returns to the original database', async () => {
    const database = await import('../database-encrypted')
    database.initDatabase()
    const realPath = database.getDbPath()
    const firstRealConnection = state.instances.at(-1)!

    const entered = database.enterDemoMode()
    const demoPath = database.getDbPath()

    expect(entered.active).toBe(true)
    expect(demoPath).not.toBe(realPath)
    expect(demoPath).toContain('demo-environment')
    expect(firstRealConnection.closed).toBe(true)
    expect(existsSync(join(state.appData, 'BudgetApp', 'demo-mode.json'))).toBe(true)
    const configured = database.configureDemoMode(424242, 'duplicates')
    expect(configured.seed).toBe(424242)
    expect(configured.preset).toBe('duplicates')

    const demoConnection = state.instances.at(-1)!
    const exited = database.exitDemoMode()

    expect(exited.active).toBe(false)
    expect(database.getDbPath()).toBe(realPath)
    expect(demoConnection.closed).toBe(true)
    expect(state.instances.at(-1)!.path).toBe(realPath)
    expect(existsSync(join(state.appData, 'BudgetApp', 'demo-mode.json'))).toBe(false)
    expect(existsSync(join(state.appData, 'BudgetApp', 'demo-environment'))).toBe(false)
    database.closeDatabase()
  })

  it('reopens the demo database after an app restart until the developer exits it', async () => {
    const firstSession = await import('../database-encrypted')
    firstSession.initDatabase()
    const realPath = firstSession.getDbPath()
    firstSession.enterDemoMode()
    const demoPath = firstSession.getDbPath()
    firstSession.closeDatabase()

    vi.resetModules()
    const restartedSession = await import('../database-encrypted')
    restartedSession.initDatabase()

    expect(restartedSession.getDemoModeStatus().active).toBe(true)
    expect(restartedSession.getDbPath()).toBe(demoPath)
    expect(restartedSession.getDbPath()).not.toBe(realPath)

    restartedSession.exitDemoMode()
    expect(restartedSession.getDbPath()).toBe(realPath)
    restartedSession.closeDatabase()
  })
})
