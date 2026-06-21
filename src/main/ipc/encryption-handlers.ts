import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  isKeystoreInitialized,
  isKeystoreUnlocked,
  initializeEncryption,
  unlockKeystore,
  lockKeystore,
  changeMasterPassword
} from '../crypto/keyManager'
import {
  requiresEncryptionSetup,
  requiresMigration,
  performMigration,
  initDatabase,
  isDatabaseInitialized
} from '../database-encrypted'
import {
  scanDatabaseIntegrity,
  getIntegrityWarnings,
  clearIntegrityWarnings,
  backfillHMACs
} from '../crypto/integrity'

// Zod schemas for input validation
const SetupPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters')
})

const UnlockSchema = z.object({
  password: z.string().min(1, 'Password is required')
})

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters')
})

/**
 * Validate input against a Zod schema
 */
function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data)
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Validation error: ${error.issues.map((e: z.ZodIssue) => e.message).join(', ')}`)
    }
    throw error
  }
}

/**
 * Register encryption-related IPC handlers
 */
export function registerEncryptionHandlers(): void {
  // Check if encryption setup is required
  ipcMain.handle('encryption:requiresSetup', () => {
    return requiresEncryptionSetup()
  })

  // Check if database migration is required
  ipcMain.handle('encryption:requiresMigration', () => {
    return requiresMigration()
  })

  // Check if keystore is unlocked
  ipcMain.handle('encryption:isUnlocked', () => {
    return isKeystoreUnlocked()
  })

  // Check if database is initialized
  ipcMain.handle('encryption:isDatabaseReady', () => {
    return isDatabaseInitialized()
  })

  // Setup encryption with master password (first-time setup)
  ipcMain.handle('encryption:setup', async (_, data: unknown) => {
    try {
      const { password } = validateInput(SetupPasswordSchema, data)
      
      if (isKeystoreInitialized()) {
        throw new Error('Encryption already set up')
      }
      
      await initializeEncryption(password)
      
      // Check if migration is needed
      if (requiresMigration()) {
        await performMigration()
      } else {
        // Initialize new encrypted database
        initDatabase()
      }
      
      return { success: true }
    } catch (error) {
      console.error('Encryption setup failed:', error)
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }
    }
  })

  // Unlock the keystore with master password
  ipcMain.handle('encryption:unlock', async (_, data: unknown) => {
    try {
      const { password } = validateInput(UnlockSchema, data)
      
      if (!isKeystoreInitialized()) {
        throw new Error('Encryption not set up')
      }
      
      const unlocked = await unlockKeystore(password)
      
      if (!unlocked) {
        return { success: false, error: 'Incorrect password' }
      }
      
      // Initialize database after successful unlock
      initDatabase()
      
      return { success: true }
    } catch (error) {
      console.error('Unlock failed:', error)
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }
    }
  })

  // Lock the keystore
  ipcMain.handle('encryption:lock', () => {
    try {
      lockKeystore()
      return { success: true }
    } catch (error) {
      console.error('Lock failed:', error)
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }
    }
  })

  // Change master password
  ipcMain.handle('encryption:changePassword', async (_, data: unknown) => {
    try {
      const { currentPassword, newPassword } = validateInput(ChangePasswordSchema, data)
      
      if (!isKeystoreUnlocked()) {
        throw new Error('Keystore must be unlocked to change password')
      }
      
      const success = await changeMasterPassword(currentPassword, newPassword)
      
      if (!success) {
        return { success: false, error: 'Current password is incorrect' }
      }
      
      return { success: true }
    } catch (error) {
      console.error('Password change failed:', error)
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }
    }
  })

  // Integrity checking handlers
  ipcMain.handle('integrity:scan', () => {
    try {
      if (!isKeystoreUnlocked()) {
        throw new Error('Database must be unlocked to scan integrity')
      }
      
      const results = scanDatabaseIntegrity()
      return { success: true, results }
    } catch (error) {
      console.error('Integrity scan failed:', error)
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }
    }
  })

  ipcMain.handle('integrity:getWarnings', () => {
    try {
      if (!isKeystoreUnlocked()) {
        throw new Error('Database must be unlocked to get warnings')
      }
      
      const warnings = getIntegrityWarnings()
      return { success: true, warnings }
    } catch (error) {
      console.error('Get warnings failed:', error)
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }
    }
  })

  ipcMain.handle('integrity:clearWarnings', () => {
    try {
      if (!isKeystoreUnlocked()) {
        throw new Error('Database must be unlocked to clear warnings')
      }
      
      clearIntegrityWarnings()
      return { success: true }
    } catch (error) {
      console.error('Clear warnings failed:', error)
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }
    }
  })

  ipcMain.handle('integrity:backfillHMACs', () => {
    try {
      if (!isKeystoreUnlocked()) {
        throw new Error('Database must be unlocked to backfill HMACs')
      }
      
      const results = backfillHMACs()
      return { success: true, results }
    } catch (error) {
      console.error('Backfill HMACs failed:', error)
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }
    }
  })
}

// Made with Bob
