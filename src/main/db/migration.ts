import Database from 'better-sqlite3'
import SqlCipher from 'better-sqlite3-multiple-ciphers'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, renameSync, unlinkSync, writeFileSync, readFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { getDEK } from '../crypto/keyManager'

/**
 * Get the path to the database directory
 */
function getDbDir(): string {
  return join(app.getPath('appData'), 'BudgetApp')
}

/**
 * Get the path to the unencrypted database
 */
function getUnencryptedDbPath(): string {
  return join(getDbDir(), 'data.db')
}

/**
 * Get the path to the encrypted database
 */
export function getEncryptedDbPath(): string {
  return join(getDbDir(), 'data_encrypted.db')
}

/**
 * Get the path to the backup of the original unencrypted database
 */
function getBackupDbPath(): string {
  return join(getDbDir(), 'data_backup_pre_encryption.db')
}

/**
 * Securely delete a file by overwriting with random data before unlinking
 */
function secureDelete(filePath: string): void {
  if (!existsSync(filePath)) {
    return
  }
  
  try {
    // Get file size
    const stats = require('fs').statSync(filePath)
    const fileSize = stats.size
    
    // Overwrite with random data in chunks
    const chunkSize = 1024 * 1024 // 1MB chunks
    const fd = require('fs').openSync(filePath, 'r+')
    
    for (let offset = 0; offset < fileSize; offset += chunkSize) {
      const size = Math.min(chunkSize, fileSize - offset)
      const randomData = randomBytes(size)
      require('fs').writeSync(fd, randomData, 0, size, offset)
    }
    
    require('fs').closeSync(fd)
    
    // Now unlink the file
    unlinkSync(filePath)
    
    console.log(`Securely deleted: ${filePath}`)
  } catch (error) {
    console.error(`Failed to securely delete ${filePath}:`, error)
    // Fall back to regular unlink
    try {
      unlinkSync(filePath)
    } catch (e) {
      console.error(`Failed to unlink ${filePath}:`, e)
    }
  }
}

/**
 * Check if migration is needed
 */
export function needsMigration(): boolean {
  const unencryptedExists = existsSync(getUnencryptedDbPath())
  const encryptedExists = existsSync(getEncryptedDbPath())
  
  // Migration needed if unencrypted DB exists and encrypted doesn't
  return unencryptedExists && !encryptedExists
}

/**
 * Check if encrypted database exists
 */
export function hasEncryptedDatabase(): boolean {
  return existsSync(getEncryptedDbPath())
}

/**
 * Migrate the unencrypted database to an encrypted SQLCipher database
 * This is a one-time operation that should be run after the user sets up encryption
 */
export async function migrateToEncrypted(): Promise<void> {
  const unencryptedPath = getUnencryptedDbPath()
  const encryptedPath = getEncryptedDbPath()
  const backupPath = getBackupDbPath()
  
  if (!existsSync(unencryptedPath)) {
    throw new Error('Unencrypted database not found')
  }
  
  if (existsSync(encryptedPath)) {
    throw new Error('Encrypted database already exists')
  }
  
  const dek = getDEK()
  if (!dek) {
    throw new Error('DEK not available - keystore must be unlocked first')
  }
  
  console.log('Starting database migration to encrypted format...')
  
  try {
    // Step 1: Create backup of original database
    console.log('Creating backup of original database...')
    renameSync(unencryptedPath, backupPath)
    
    // Step 2: Open the backup database (unencrypted)
    const sourceDb = new Database(backupPath, { readonly: true })
    
    // Step 3: Create new encrypted database
    console.log('Creating encrypted database...')
    const targetDb = new SqlCipher(encryptedPath)
    
    // Set the encryption key (DEK as hex string)
    const dekHex = dek.toString('hex')
    targetDb.pragma(`key = "x'${dekHex}'"`)
    
    // Set SQLCipher parameters for compatibility and security
    targetDb.pragma('cipher_page_size = 4096')
    targetDb.pragma('kdf_iter = 256000')
    targetDb.pragma('cipher_hmac_algorithm = HMAC_SHA512')
    targetDb.pragma('cipher_kdf_algorithm = PBKDF2_HMAC_SHA512')
    
    // Enable WAL mode and foreign keys
    targetDb.pragma('journal_mode = WAL')
    targetDb.pragma('foreign_keys = ON')
    
    // Step 4: Get schema from source database
    console.log('Copying schema...')
    const schema = sourceDb.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all() as Array<{ sql: string }>
    
    // Create tables in target database
    for (const { sql } of schema) {
      if (sql) {
        targetDb.exec(sql)
      }
    }
    
    // Copy indexes
    const indexes = sourceDb.prepare(
      "SELECT sql FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
    ).all() as Array<{ sql: string | null }>
    
    for (const { sql } of indexes) {
      if (sql) {
        targetDb.exec(sql)
      }
    }
    
    // Step 5: Copy data from all tables
    console.log('Copying data...')
    const tables = sourceDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all() as Array<{ name: string }>
    
    for (const { name } of tables) {
      console.log(`  Copying table: ${name}`)
      
      // Get column names
      const columns = sourceDb.pragma(`table_info(${name})`) as Array<{ name: string }>
      const columnNames = columns.map(c => c.name).join(', ')
      const placeholders = columns.map(() => '?').join(', ')
      
      // Read all rows from source
      const rows = sourceDb.prepare(`SELECT * FROM ${name}`).all()
      
      if (rows.length > 0) {
        // Insert into target
        const insert = targetDb.prepare(
          `INSERT INTO ${name} (${columnNames}) VALUES (${placeholders})`
        )
        
        const insertMany = targetDb.transaction((rows: any[]) => {
          for (const row of rows) {
            const values = columns.map(c => (row as any)[c.name])
            insert.run(...values)
          }
        })
        
        insertMany(rows)
        console.log(`    Copied ${rows.length} rows`)
      }
    }
    
    // Step 6: Add HMAC columns to financial tables
    console.log('Adding HMAC columns for integrity checking...')
    try {
      targetDb.exec(`
        ALTER TABLE transactions ADD COLUMN hmac TEXT;
        ALTER TABLE budget_entries ADD COLUMN hmac TEXT;
        ALTER TABLE goals ADD COLUMN hmac TEXT;
        ALTER TABLE categories ADD COLUMN hmac TEXT;
      `)
    } catch (error) {
      console.log('HMAC columns may already exist:', error)
    }
    
    // Step 7: Create integrity warnings table
    console.log('Creating integrity warnings table...')
    targetDb.exec(`
      CREATE TABLE IF NOT EXISTS integrity_warnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        row_id INTEGER NOT NULL,
        reason TEXT NOT NULL,
        detected_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_integrity_warnings_table ON integrity_warnings(table_name);
    `)
    
    // Close databases
    sourceDb.close()
    targetDb.close()
    
    console.log('Migration completed successfully!')
    
    // Step 8: Securely delete the backup (original unencrypted database)
    console.log('Securely deleting unencrypted backup...')
    secureDelete(backupPath)
    
    console.log('Database migration complete. Encrypted database is now active.')
    
  } catch (error) {
    console.error('Migration failed:', error)
    
    // Attempt to restore from backup if it exists
    if (existsSync(backupPath)) {
      console.log('Attempting to restore from backup...')
      try {
        if (existsSync(encryptedPath)) {
          unlinkSync(encryptedPath)
        }
        renameSync(backupPath, unencryptedPath)
        console.log('Restored from backup')
      } catch (restoreError) {
        console.error('Failed to restore from backup:', restoreError)
      }
    }
    
    throw error
  }
}

/**
 * Create a new encrypted database from scratch
 * Used when starting fresh without an existing unencrypted database
 */
export function createEncryptedDatabase(): SqlCipher.Database {
  const encryptedPath = getEncryptedDbPath()
  
  if (existsSync(encryptedPath)) {
    throw new Error('Encrypted database already exists')
  }
  
  const dek = getDEK()
  if (!dek) {
    throw new Error('DEK not available - keystore must be unlocked first')
  }
  
  console.log('Creating new encrypted database...')
  
  const db = new SqlCipher(encryptedPath)
  
  // Set the encryption key
  const dekHex = dek.toString('hex')
  db.pragma(`key = "x'${dekHex}'"`)
  
  // Set SQLCipher parameters
  db.pragma('cipher_page_size = 4096')
  db.pragma('kdf_iter = 256000')
  db.pragma('cipher_hmac_algorithm = HMAC_SHA512')
  db.pragma('cipher_kdf_algorithm = PBKDF2_HMAC_SHA512')
  
  // Enable WAL mode and foreign keys
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  
  console.log('Encrypted database created successfully')
  
  return db
}

/**
 * Open the encrypted database
 */
export function openEncryptedDatabase(): SqlCipher.Database {
  const encryptedPath = getEncryptedDbPath()
  
  if (!existsSync(encryptedPath)) {
    throw new Error('Encrypted database does not exist')
  }
  
  const dek = getDEK()
  if (!dek) {
    throw new Error('DEK not available - keystore must be unlocked first')
  }
  
  const db = new SqlCipher(encryptedPath)
  
  // Set the encryption key
  const dekHex = dek.toString('hex')
  db.pragma(`key = "x'${dekHex}'"`)
  
  // Set SQLCipher parameters
  db.pragma('cipher_page_size = 4096')
  db.pragma('kdf_iter = 256000')
  db.pragma('cipher_hmac_algorithm = HMAC_SHA512')
  db.pragma('cipher_kdf_algorithm = PBKDF2_HMAC_SHA512')
  
  // Enable WAL mode and foreign keys
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  
  // Verify the database can be accessed (will throw if key is wrong)
  try {
    db.prepare('SELECT count(*) FROM sqlite_master').get()
  } catch (error) {
    db.close()
    throw new Error('Failed to decrypt database - incorrect key or corrupted database')
  }
  
  return db
}

/**
 * Export the encrypted database to an unencrypted backup file
 * Useful for data recovery or migration to another system
 */
export function exportUnencrypted(outputPath: string): void {
  const encryptedPath = getEncryptedDbPath()
  
  if (!existsSync(encryptedPath)) {
    throw new Error('Encrypted database does not exist')
  }
  
  const dek = getDEK()
  if (!dek) {
    throw new Error('DEK not available - keystore must be unlocked first')
  }
  
  console.log('Exporting to unencrypted backup...')
  
  // Open encrypted database
  const sourceDb = openEncryptedDatabase()
  
  // Create unencrypted target database
  const targetDb = new Database(outputPath)
  targetDb.pragma('journal_mode = WAL')
  
  // Attach and copy
  sourceDb.exec(`
    ATTACH DATABASE '${outputPath}' AS plaintext KEY '';
    SELECT sqlcipher_export('plaintext');
    DETACH DATABASE plaintext;
  `)
  
  sourceDb.close()
  targetDb.close()
  
  console.log(`Exported to: ${outputPath}`)
}

// Made with Bob
