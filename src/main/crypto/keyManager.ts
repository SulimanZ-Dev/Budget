import { randomBytes, createCipheriv, createDecipheriv, createHmac } from 'crypto'
import * as argon2 from 'argon2'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs'

/**
 * Argon2id parameters for key derivation
 * Memory cost: 64MB (65536 KiB)
 * Time cost: 3 iterations
 * Parallelism: 4 threads
 * 
 * These parameters provide strong security while maintaining reasonable
 * performance on modern hardware. Adjust based on your security requirements.
 */
const ARGON2_PARAMS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
  hashLength: 32 // 256 bits
}

const AES_ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // 96 bits for GCM
const AUTH_TAG_LENGTH = 16 // 128 bits
const SALT_LENGTH = 32 // 256 bits

interface KeystoreData {
  version: number
  salt: string // hex-encoded Argon2 salt
  encryptedDEK: string // hex-encoded encrypted DEK
  dekIV: string // hex-encoded IV for DEK encryption
  dekAuthTag: string // hex-encoded auth tag for DEK encryption
  signingKeyEncrypted: string // hex-encoded encrypted signing key
  signingKeyIV: string
  signingKeyAuthTag: string
}

interface MachineKeyData {
  machineSecret: string // hex-encoded random value
}

let masterPasswordBuffer: Buffer | null = null
let kekBuffer: Buffer | null = null
let dekBuffer: Buffer | null = null
let signingKeyBuffer: Buffer | null = null

/**
 * Securely zeros out a buffer's contents
 */
function zeroBuffer(buffer: Buffer): void {
  if (buffer && Buffer.isBuffer(buffer)) {
    buffer.fill(0)
  }
}

/**
 * Get the directory for storing encryption metadata
 */
function getKeystoreDir(): string {
  const dir = join(app.getPath('appData'), 'BudgetApp')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * Get the path to the keystore file
 */
function getKeystorePath(): string {
  return join(getKeystoreDir(), 'keystore.json')
}

/**
 * Get the path to the machine key file (for fallback encryption)
 */
function getMachineKeyPath(): string {
  return join(getKeystoreDir(), '.machine_key')
}

/**
 * Check if the keystore exists (i.e., if encryption has been set up)
 */
export function isKeystoreInitialized(): boolean {
  return existsSync(getKeystorePath())
}

/**
 * Generate or load the machine-bound key for fallback encryption
 */
function getMachineKey(): Buffer {
  const path = getMachineKeyPath()
  
  if (existsSync(path)) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as MachineKeyData
      return Buffer.from(data.machineSecret, 'hex')
    } catch (error) {
      console.error('Failed to read machine key, generating new one:', error)
    }
  }
  
  // Generate new machine key
  const machineSecret = randomBytes(32)
  const data: MachineKeyData = {
    machineSecret: machineSecret.toString('hex')
  }
  
  writeFileSync(path, JSON.stringify(data), { mode: 0o600 })
  
  // Set file permissions to 0600 (owner read/write only) on Unix-like systems
  try {
    chmodSync(path, 0o600)
  } catch (error) {
    // Windows doesn't support chmod, ignore error
  }
  
  return machineSecret
}

/**
 * Derive a Key Encryption Key (KEK) from the master password using Argon2id
 */
async function deriveKEK(password: Buffer, salt: Buffer): Promise<Buffer> {
  const hash = await argon2.hash(password, {
    ...ARGON2_PARAMS,
    salt,
    raw: true // Return raw buffer instead of encoded string
  })
  
  return Buffer.from(hash)
}

/**
 * Encrypt data using AES-256-GCM
 */
function encryptAES(data: Buffer, key: Buffer): { encrypted: Buffer; iv: Buffer; authTag: Buffer } {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(AES_ALGORITHM, key, iv)
  
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()])
  const authTag = cipher.getAuthTag()
  
  return { encrypted, iv, authTag }
}

/**
 * Decrypt data using AES-256-GCM
 */
function decryptAES(encrypted: Buffer, key: Buffer, iv: Buffer, authTag: Buffer): Buffer {
  const decipher = createDecipheriv(AES_ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  
  return Buffer.concat([decipher.update(encrypted), decipher.final()])
}

/**
 * Initialize encryption with a new master password
 * This should only be called once during first-time setup
 */
export async function initializeEncryption(masterPassword: string): Promise<void> {
  if (isKeystoreInitialized()) {
    throw new Error('Encryption already initialized')
  }
  
  // Convert password to buffer
  const passwordBuffer = Buffer.from(masterPassword, 'utf8')
  
  try {
    // Generate salt for Argon2
    const salt = randomBytes(SALT_LENGTH)
    
    // Derive KEK from master password
    const kek = await deriveKEK(passwordBuffer, salt)
    
    // Generate random DEK (Data Encryption Key)
    const dek = randomBytes(32)
    
    // Generate random signing key for HMAC
    const signingKey = randomBytes(32)
    
    // Encrypt DEK with KEK
    const { encrypted: encryptedDEK, iv: dekIV, authTag: dekAuthTag } = encryptAES(dek, kek)
    
    // Encrypt signing key with KEK
    const { encrypted: encryptedSigningKey, iv: signingKeyIV, authTag: signingKeyAuthTag } = encryptAES(signingKey, kek)
    
    // Store keystore data
    const keystoreData: KeystoreData = {
      version: 1,
      salt: salt.toString('hex'),
      encryptedDEK: encryptedDEK.toString('hex'),
      dekIV: dekIV.toString('hex'),
      dekAuthTag: dekAuthTag.toString('hex'),
      signingKeyEncrypted: encryptedSigningKey.toString('hex'),
      signingKeyIV: signingKeyIV.toString('hex'),
      signingKeyAuthTag: signingKeyAuthTag.toString('hex')
    }
    
    writeFileSync(getKeystorePath(), JSON.stringify(keystoreData, null, 2))
    
    // Store keys in memory
    masterPasswordBuffer = passwordBuffer
    kekBuffer = kek
    dekBuffer = dek
    signingKeyBuffer = signingKey
    
  } catch (error) {
    // Clean up on error
    zeroBuffer(passwordBuffer)
    throw error
  }
}

/**
 * Unlock the keystore with the master password
 * This must be called on every app launch before accessing the encrypted database
 */
export async function unlockKeystore(masterPassword: string): Promise<boolean> {
  if (!isKeystoreInitialized()) {
    throw new Error('Encryption not initialized')
  }
  
  const passwordBuffer = Buffer.from(masterPassword, 'utf8')
  
  try {
    // Load keystore
    const keystoreData = JSON.parse(readFileSync(getKeystorePath(), 'utf8')) as KeystoreData
    
    // Parse stored data
    const salt = Buffer.from(keystoreData.salt, 'hex')
    const encryptedDEK = Buffer.from(keystoreData.encryptedDEK, 'hex')
    const dekIV = Buffer.from(keystoreData.dekIV, 'hex')
    const dekAuthTag = Buffer.from(keystoreData.dekAuthTag, 'hex')
    const encryptedSigningKey = Buffer.from(keystoreData.signingKeyEncrypted, 'hex')
    const signingKeyIV = Buffer.from(keystoreData.signingKeyIV, 'hex')
    const signingKeyAuthTag = Buffer.from(keystoreData.signingKeyAuthTag, 'hex')
    
    // Derive KEK from password
    const kek = await deriveKEK(passwordBuffer, salt)
    
    // Try to decrypt DEK
    try {
      const dek = decryptAES(encryptedDEK, kek, dekIV, dekAuthTag)
      const signingKey = decryptAES(encryptedSigningKey, kek, signingKeyIV, signingKeyAuthTag)
      
      // Store keys in memory
      masterPasswordBuffer = passwordBuffer
      kekBuffer = kek
      dekBuffer = dek
      signingKeyBuffer = signingKey
      
      return true
    } catch (error) {
      // Decryption failed - wrong password
      zeroBuffer(passwordBuffer)
      zeroBuffer(kek)
      return false
    }
  } catch (error) {
    zeroBuffer(passwordBuffer)
    throw error
  }
}

/**
 * Get the Data Encryption Key (DEK) for database encryption
 * Returns null if keystore is not unlocked
 */
export function getDEK(): Buffer | null {
  return dekBuffer
}

/**
 * Get the signing key for HMAC operations
 * Returns null if keystore is not unlocked
 */
export function getSigningKey(): Buffer | null {
  return signingKeyBuffer
}

/**
 * Check if the keystore is currently unlocked
 */
export function isKeystoreUnlocked(): boolean {
  return dekBuffer !== null && signingKeyBuffer !== null
}

/**
 * Lock the keystore by clearing all keys from memory
 */
export function lockKeystore(): void {
  zeroBuffer(masterPasswordBuffer!)
  zeroBuffer(kekBuffer!)
  zeroBuffer(dekBuffer!)
  zeroBuffer(signingKeyBuffer!)
  
  masterPasswordBuffer = null
  kekBuffer = null
  dekBuffer = null
  signingKeyBuffer = null
}

/**
 * Change the master password
 * Requires the current password to be verified first
 */
export async function changeMasterPassword(currentPassword: string, newPassword: string): Promise<boolean> {
  if (!isKeystoreInitialized()) {
    throw new Error('Encryption not initialized')
  }
  
  // Verify current password
  const unlocked = await unlockKeystore(currentPassword)
  if (!unlocked) {
    return false
  }
  
  const newPasswordBuffer = Buffer.from(newPassword, 'utf8')
  
  try {
    // Generate new salt
    const newSalt = randomBytes(SALT_LENGTH)
    
    // Derive new KEK from new password
    const newKEK = await deriveKEK(newPasswordBuffer, newSalt)
    
    // Re-encrypt DEK and signing key with new KEK
    const { encrypted: encryptedDEK, iv: dekIV, authTag: dekAuthTag } = encryptAES(dekBuffer!, newKEK)
    const { encrypted: encryptedSigningKey, iv: signingKeyIV, authTag: signingKeyAuthTag } = encryptAES(signingKeyBuffer!, newKEK)
    
    // Update keystore
    const keystoreData: KeystoreData = {
      version: 1,
      salt: newSalt.toString('hex'),
      encryptedDEK: encryptedDEK.toString('hex'),
      dekIV: dekIV.toString('hex'),
      dekAuthTag: dekAuthTag.toString('hex'),
      signingKeyEncrypted: encryptedSigningKey.toString('hex'),
      signingKeyIV: signingKeyIV.toString('hex'),
      signingKeyAuthTag: signingKeyAuthTag.toString('hex')
    }
    
    writeFileSync(getKeystorePath(), JSON.stringify(keystoreData, null, 2))
    
    // Update in-memory keys
    zeroBuffer(masterPasswordBuffer!)
    zeroBuffer(kekBuffer!)
    masterPasswordBuffer = newPasswordBuffer
    kekBuffer = newKEK
    
    return true
  } catch (error) {
    zeroBuffer(newPasswordBuffer)
    throw error
  }
}

/**
 * Encrypt sensitive data using machine-bound key (for fallback storage)
 * This replaces the insecure base64 encoding currently used
 */
export function encryptWithMachineKey(data: string): string {
  const machineKey = getMachineKey()
  const dataBuffer = Buffer.from(data, 'utf8')
  
  const { encrypted, iv, authTag } = encryptAES(dataBuffer, machineKey)
  
  // Combine IV + authTag + encrypted data
  const combined = Buffer.concat([iv, authTag, encrypted])
  
  zeroBuffer(dataBuffer)
  
  return combined.toString('base64')
}

/**
 * Decrypt sensitive data using machine-bound key (for fallback storage)
 */
export function decryptWithMachineKey(encryptedData: string): string {
  const machineKey = getMachineKey()
  const combined = Buffer.from(encryptedData, 'base64')
  
  // Extract IV, authTag, and encrypted data
  const iv = combined.subarray(0, IV_LENGTH)
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
  
  const decrypted = decryptAES(encrypted, machineKey, iv, authTag)
  const result = decrypted.toString('utf8')
  
  zeroBuffer(decrypted)
  
  return result
}

/**
 * Derive a key using HKDF-SHA256 for specific purposes
 * Used to derive per-table signing keys from the master signing key
 */
export function deriveKey(purpose: string, length: number = 32): Buffer {
  if (!signingKeyBuffer) {
    throw new Error('Keystore not unlocked')
  }
  
  // Simple HKDF implementation using HMAC-SHA256
  const prk = createHmac('sha256', signingKeyBuffer).update(purpose).digest()
  const okm = createHmac('sha256', prk).update(Buffer.from([1])).digest()
  
  return okm.subarray(0, length)
}

// Made with Bob
