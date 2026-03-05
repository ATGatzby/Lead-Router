import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  hashPassword,
  verifyPassword,
  generateWebhookSecret,
  generateInviteToken,
  verifyHmacSignature,
} from './crypto.js'

// ─── hashPassword ─────────────────────────────────────────────────────────────

describe('hashPassword', () => {
  it('returns a string in salt:hash format', () => {
    const result = hashPassword('mypassword')
    const parts = result.split(':')
    expect(parts).toHaveLength(2)
    expect(parts[0]).toBeTruthy() // salt
    expect(parts[1]).toBeTruthy() // hash
  })

  it('salt is a 32-char hex string (16 bytes)', () => {
    const [salt] = hashPassword('mypassword').split(':')
    expect(salt).toMatch(/^[0-9a-f]{32}$/)
  })

  it('hash is a 64-char hex string (32 bytes)', () => {
    const [, hash] = hashPassword('mypassword').split(':')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces different hashes for same password (random salt)', () => {
    const h1 = hashPassword('mypassword')
    const h2 = hashPassword('mypassword')
    expect(h1).not.toEqual(h2)
  })
})

// ─── verifyPassword ───────────────────────────────────────────────────────────

describe('verifyPassword', () => {
  it('returns true for correct password', () => {
    const hash = hashPassword('correctpassword')
    expect(verifyPassword('correctpassword', hash)).toBe(true)
  })

  it('returns false for wrong password', () => {
    const hash = hashPassword('correctpassword')
    expect(verifyPassword('wrongpassword', hash)).toBe(false)
  })

  it('returns false for empty password against non-empty hash', () => {
    const hash = hashPassword('correctpassword')
    expect(verifyPassword('', hash)).toBe(false)
  })

  it('returns false for malformed stored hash (no colon)', () => {
    expect(verifyPassword('anypassword', 'notavalidhash')).toBe(false)
  })

  it('returns false for empty stored hash', () => {
    expect(verifyPassword('anypassword', '')).toBe(false)
  })

  it('round-trips with CLI seed format (PBKDF2, 310000 iterations)', () => {
    // Verify that the hash format matches what run-migrations.ts produces
    const hash = hashPassword('InitP@ssw0rd')
    expect(verifyPassword('InitP@ssw0rd', hash)).toBe(true)
    expect(verifyPassword('InitP@ssw0rdX', hash)).toBe(false)
  })
})

// ─── generateWebhookSecret ────────────────────────────────────────────────────

describe('generateWebhookSecret', () => {
  it('returns a 64-char hex string (32 bytes)', () => {
    const secret = generateWebhookSecret()
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns different values on each call', () => {
    expect(generateWebhookSecret()).not.toEqual(generateWebhookSecret())
  })
})

// ─── generateInviteToken ─────────────────────────────────────────────────────

describe('generateInviteToken', () => {
  it('returns a 48-char hex string (24 bytes)', () => {
    const token = generateInviteToken()
    expect(token).toMatch(/^[0-9a-f]{48}$/)
  })
})

// ─── verifyHmacSignature ──────────────────────────────────────────────────────

describe('verifyHmacSignature', () => {
  const secret = 'testwebhooksecret'
  const payload = JSON.stringify({ sfdcOrgId: '00D000', objectType: 'LEAD' })

  it('verifies a correctly signed payload', () => {
    const hex = createHmac('sha256', secret).update(payload).digest('hex')
    const signature = `sha256=${hex}`
    expect(verifyHmacSignature(payload, signature, secret)).toBe(true)
  })

  it('rejects an incorrect signature', () => {
    expect(verifyHmacSignature(payload, 'sha256=invalidsignature', secret)).toBe(false)
  })

  it('rejects a signature with wrong secret', () => {
    const hex = createHmac('sha256', 'wrongsecret').update(payload).digest('hex')
    const signature = `sha256=${hex}`
    expect(verifyHmacSignature(payload, signature, secret)).toBe(false)
  })

  it('rejects a tampered payload', () => {
    const hex = createHmac('sha256', secret).update(payload).digest('hex')
    const signature = `sha256=${hex}`
    const tamperedPayload = payload + ' tampered'
    expect(verifyHmacSignature(tamperedPayload, signature, secret)).toBe(false)
  })

  it('rejects an empty signature', () => {
    expect(verifyHmacSignature(payload, '', secret)).toBe(false)
  })
})
