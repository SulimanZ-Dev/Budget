import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'crypto'
import {
  initializeEncryption,
  unlockKeystore,
  lockKeystore,
  isKeystoreUnlocked,
  getDEK,
  getSigningKey,
  encryptWithMachineKey,
  decryptWithMachineKey
} from '../keyManager'

describe('KeyManager', () => {
  const testPassword = 'TestPassword123!'
  
  afterEach(() => {
    // Clean up after each test
    lockKeystore()
  })

  describe('Encryption/Decryption Round-trips', () => {
    it('should encrypt and decrypt data with machine key', () => {
      const testData = 'sensitive-api-key-12345'
      
      const encrypted = encryptWithMachineKey(testData)
      expect(encrypted).toBeTruthy()
      expect(encrypted).not.toBe(testData)
      
      const decrypted = decryptWithMachineKey(encrypted)
      expect(decrypted).toBe(testData)
    })

    it('should produce different ciphertexts for same plaintext', () => {
      const testData = 'test-data'
      
      const encrypted1 = encryptWithMachineKey(testData)
      const encrypted2 = encryptWithMachineKey(testData)
      
      // Different IVs should produce different ciphertexts
      expect(encrypted1).not.toBe(encrypted2)
      
      // But both should decrypt to same plaintext
      expect(decryptWithMachineKey(encrypted1)).toBe(testData)
      expect(decryptWithMachineKey(encrypted2)).toBe(testData)
    })

    it('should fail to decrypt tampered ciphertext', () => {
      const testData = 'test-data'
      const encrypted = encryptWithMachineKey(testData)
      
      // Tamper with the ciphertext
      const buffer = Buffer.from(encrypted, 'base64')
      buffer[buffer.length - 1] ^= 0xFF // Flip bits in last byte
      const tampered = buffer.toString('base64')
      
      // Should throw on decryption
      expect(() => decryptWithMachineKey(tampered)).toThrow()
    })
  })

  describe('Keystore State', () => {
    it('should report unlocked state correctly', () => {
      expect(isKeystoreUnlocked()).toBe(false)
      
      // Note: Full initialization test would require mocking file system
      // This is a basic state check
    })

    it('should clear keys on lock', () => {
      lockKeystore()
      expect(isKeystoreUnlocked()).toBe(false)
      expect(getDEK()).toBeNull()
      expect(getSigningKey()).toBeNull()
    })
  })

  describe('Key Derivation', () => {
    it('should derive consistent keys from same password and salt', async () => {
      // This test verifies Argon2 consistency
      const password = Buffer.from('test-password', 'utf8')
      const salt = randomBytes(32)
      
      const argon2 = await import('argon2')
      
      const key1 = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
        hashLength: 32,
        salt,
        raw: true
      })
      
      const key2 = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
        hashLength: 32,
        salt,
        raw: true
      })
      
      expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(true)
    })

    it('should derive different keys from different salts', async () => {
      const password = Buffer.from('test-password', 'utf8')
      const salt1 = randomBytes(32)
      const salt2 = randomBytes(32)
      
      const argon2 = await import('argon2')
      
      const key1 = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
        hashLength: 32,
        salt: salt1,
        raw: true
      })
      
      const key2 = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
        hashLength: 32,
        salt: salt2,
        raw: true
      })
      
      expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(false)
    })
  })

  describe('AES-GCM Encryption', () => {
    it('should use proper key and IV sizes', () => {
      const testData = 'test'
      const encrypted = encryptWithMachineKey(testData)
      const buffer = Buffer.from(encrypted, 'base64')
      
      // IV (12 bytes) + Auth Tag (16 bytes) + Ciphertext
      expect(buffer.length).toBeGreaterThanOrEqual(28)
    })
  })
})

// Made with Bob
