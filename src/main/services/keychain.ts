const SERVICE = 'BudgetApp'
const ACCOUNT = 'claude-api-key'

let keytar: typeof import('keytar') | null = null

async function getKeytar(): Promise<typeof import('keytar') | null> {
  if (keytar) return keytar
  try {
    keytar = await import('keytar')
    return keytar
  } catch {
    return null
  }
}

export async function saveApiKey(key: string): Promise<boolean> {
  const kt = await getKeytar()
  if (kt) {
    await kt.setPassword(SERVICE, ACCOUNT, key)
    return true
  }
  const { getDatabase } = await import('../database')
  const db = getDatabase()
  db.prepare(
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('encryptedApiKey', ?)`
  ).run(Buffer.from(key).toString('base64'))
  return false
}

export async function getApiKey(): Promise<string | null> {
  const kt = await getKeytar()
  if (kt) {
    return kt.getPassword(SERVICE, ACCOUNT)
  }
  const { getDatabase } = await import('../database')
  const db = getDatabase()
  const row = db.prepare("SELECT value FROM settings WHERE key = 'encryptedApiKey'").get() as
    | { value: string }
    | undefined
  if (!row?.value) return null
  return Buffer.from(row.value, 'base64').toString('utf8')
}

export async function deleteApiKey(): Promise<void> {
  const kt = await getKeytar()
  if (kt) {
    await kt.deletePassword(SERVICE, ACCOUNT)
    return
  }
  const { getDatabase } = await import('../database')
  getDatabase().prepare("DELETE FROM settings WHERE key = 'encryptedApiKey'").run()
}

export async function hasApiKey(): Promise<boolean> {
  const key = await getApiKey()
  return !!key && key.length > 0
}
