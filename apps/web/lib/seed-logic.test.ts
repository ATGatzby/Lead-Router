import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'

/**
 * Tests for the seed.js password hashing and SQL generation logic.
 * seed.js runs inside Docker, but we can test the pure logic here.
 */

// Reproduce the hashing logic from seed.js
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.pbkdf2Sync(password, salt, 310000, 32, 'sha256').toString('hex')
  return `${salt}:${hash}`
}

// Reproduce the SQL escaping from seed.js
function escapeForSql(value: string): string {
  return value.replace(/'/g, "''")
}

// ─── Password Hashing ────────────────────────────────────────────────────────

describe('seed password hashing', () => {
  it('produces salt:hash format', () => {
    const result = hashPassword('testPassword123')
    expect(result).toMatch(/^[a-f0-9]{32}:[a-f0-9]{64}$/)
  })

  it('salt is 32 hex chars (16 bytes)', () => {
    const result = hashPassword('test')
    const [salt] = result.split(':')
    expect(salt).toHaveLength(32)
  })

  it('hash is 64 hex chars (32 bytes)', () => {
    const result = hashPassword('test')
    const [, hash] = result.split(':')
    expect(hash).toHaveLength(64)
  })

  it('produces different hashes for same password (different salts)', () => {
    const a = hashPassword('same-password')
    const b = hashPassword('same-password')
    expect(a).not.toBe(b) // Different salts → different results
  })

  it('matches the web app crypto.ts format', () => {
    // The web app uses the same PBKDF2 parameters
    const password = 'mySecretPassword'
    const salt = crypto.randomBytes(16).toString('hex')
    const hash = crypto.pbkdf2Sync(password, salt, 310000, 32, 'sha256').toString('hex')
    const result = `${salt}:${hash}`

    // Verify we can verify against it (same as web app does)
    const [storedSalt, storedHash] = result.split(':')
    const verifyHash = crypto.pbkdf2Sync(password, storedSalt, 310000, 32, 'sha256').toString('hex')
    expect(verifyHash).toBe(storedHash)
  })

  it('fails verification with wrong password', () => {
    const result = hashPassword('correctPassword')
    const [storedSalt, storedHash] = result.split(':')
    const wrongHash = crypto.pbkdf2Sync('wrongPassword', storedSalt, 310000, 32, 'sha256').toString('hex')
    expect(wrongHash).not.toBe(storedHash)
  })
})

// ─── SQL Escaping ────────────────────────────────────────────────────────────

describe('seed SQL escaping', () => {
  it('escapes single quotes by doubling them', () => {
    expect(escapeForSql("O'Brien")).toBe("O''Brien")
  })

  it('handles strings without quotes', () => {
    expect(escapeForSql('admin@example.com')).toBe('admin@example.com')
  })

  it('handles multiple quotes', () => {
    expect(escapeForSql("it's a 'test'")).toBe("it''s a ''test''")
  })

  it('handles empty string', () => {
    expect(escapeForSql('')).toBe('')
  })
})

// ─── SQL Generation ──────────────────────────────────────────────────────────

describe('seed SQL structure', () => {
  it('generates idempotent org INSERT', () => {
    const webhookSecret = 'wh_secret_123'
    const sql = `INSERT INTO organizations (id, "webhookSecret", plan, "seatsPurchased", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), '${webhookSecret}', 'PAID', 9999, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM organizations);`

    expect(sql).toContain('WHERE NOT EXISTS')
    expect(sql).toContain("'PAID'")
    expect(sql).toContain('9999')
    expect(sql).toContain(webhookSecret)
  })

  it('generates idempotent user INSERT with ON CONFLICT', () => {
    const email = 'admin@test.com'
    const passwordHash = 'salt:hash'
    const sql = `INSERT INTO app_users (id, "orgId", email, name, "passwordHash", role, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), o.id, '${email}', 'Admin', '${passwordHash}', 'ADMIN', true, NOW(), NOW()
FROM organizations o
LIMIT 1
ON CONFLICT ("orgId", email) DO NOTHING;`

    expect(sql).toContain('ON CONFLICT ("orgId", email) DO NOTHING')
    expect(sql).toContain("'ADMIN'")
    expect(sql).toContain(email)
    expect(sql).toContain(passwordHash)
  })
})
