import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'

// We need to test decryptField which reads process.env.APP_SECRET

describe('decryptField', () => {
  const TEST_SECRET = 'test-secret-key-for-unit-tests-1234'
  let originalAppSecret: string | undefined

  beforeEach(() => {
    originalAppSecret = process.env.APP_SECRET
    process.env.APP_SECRET = TEST_SECRET
  })

  afterEach(() => {
    if (originalAppSecret !== undefined) {
      process.env.APP_SECRET = originalAppSecret
    } else {
      delete process.env.APP_SECRET
    }
  })

  // Helper: encrypt a value using the same algorithm as the web app
  function encryptField(plaintext: string, secret: string): string {
    const key = crypto.scryptSync(secret, 'lead-routing-field-enc', 32)
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    let encrypted = cipher.update(plaintext, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    const authTag = cipher.getAuthTag().toString('hex')
    return `${iv.toString('hex')}:${authTag}:${encrypted}`
  }

  it('decrypts a value encrypted with the same secret', async () => {
    const { decryptField } = await import('./crypto')
    const original = 'sk-ant-api-key-12345'
    const encrypted = encryptField(original, TEST_SECRET)
    expect(decryptField(encrypted)).toBe(original)
  })

  it('decrypts an empty string', async () => {
    const { decryptField } = await import('./crypto')
    const encrypted = encryptField('', TEST_SECRET)
    expect(decryptField(encrypted)).toBe('')
  })

  it('decrypts unicode text', async () => {
    const { decryptField } = await import('./crypto')
    const original = 'API-Key-with-émojis-🔑'
    const encrypted = encryptField(original, TEST_SECRET)
    expect(decryptField(encrypted)).toBe(original)
  })

  it('throws on invalid format (missing parts)', async () => {
    const { decryptField } = await import('./crypto')
    expect(() => decryptField('not-valid')).toThrow('Invalid encrypted field format')
  })

  it('throws on tampered ciphertext', async () => {
    const { decryptField } = await import('./crypto')
    const encrypted = encryptField('secret', TEST_SECRET)
    const parts = encrypted.split(':')
    // Tamper with the ciphertext
    parts[2] = 'ff'.repeat(parts[2].length / 2)
    expect(() => decryptField(parts.join(':'))).toThrow()
  })

  it('throws when APP_SECRET is not set', async () => {
    delete process.env.APP_SECRET
    delete process.env.SESSION_SECRET
    // Re-import to get fresh module (vitest caches, but the function reads env at call time)
    const { decryptField } = await import('./crypto')
    expect(() => decryptField('aa:bb:cc')).toThrow('APP_SECRET')
  })
})
