import { encryptWithMachineKey, decryptWithMachineKey } from '../crypto/keyManager'

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

/**
 * Save API key securely
 * Prefers Windows Credential Manager (keytar), falls back to machine-bound AES-256-GCM encryption
 */
export async function saveApiKey(key: string): Promise<boolean> {
  // Store in buffer for secure handling
  const keyBuffer = Buffer.from(key, 'utf8')
  
  try {
    const kt = await getKeytar()
    if (kt) {
      await kt.setPassword(SERVICE, ACCOUNT, key)
      keyBuffer.fill(0) // Zero out buffer
      return true
    }
    
    // Fallback: Use machine-bound encryption instead of base64
    const { getDatabase } = await import('../database')
    const db = getDatabase()
    const encrypted = encryptWithMachineKey(key)
    db.prepare(
      `INSERT OR REPLACE INTO settings (key, value) VALUES ('encryptedApiKey', ?)`
    ).run(encrypted)
    
    keyBuffer.fill(0) // Zero out buffer
    return false
  } catch (error) {
    keyBuffer.fill(0) // Zero out buffer even on error
    throw error
  }
}

/**
 * Retrieve API key securely
 */
export async function getApiKey(): Promise<string | null> {
  const kt = await getKeytar()
  if (kt) {
    const key = await kt.getPassword(SERVICE, ACCOUNT)
    return key
  }
  
  // Fallback: Decrypt from machine-bound encryption
  const { getDatabase } = await import('../database')
  const db = getDatabase()
  const row = db.prepare("SELECT value FROM settings WHERE key = 'encryptedApiKey'").get() as
    | { value: string }
    | undefined
  
  if (!row?.value) return null
  
  try {
    // Try new encryption format first
    return decryptWithMachineKey(row.value)
  } catch {
    // Fall back to old base64 format for backward compatibility
    try {
      return Buffer.from(row.value, 'base64').toString('utf8')
    } catch {
      return null
    }
  }
}

/**
 * Delete API key
 */
export async function deleteApiKey(): Promise<void> {
  const kt = await getKeytar()
  if (kt) {
    await kt.deletePassword(SERVICE, ACCOUNT)
    return
  }
  const { getDatabase } = await import('../database')
  getDatabase().prepare("DELETE FROM settings WHERE key = 'encryptedApiKey'").run()
}

/**
 * Check if API key exists
 */
export async function hasApiKey(): Promise<boolean> {
  const key = await getApiKey()
  return !!key && key.length > 0
}
