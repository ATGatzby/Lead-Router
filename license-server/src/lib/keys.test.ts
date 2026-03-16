import { describe, it, expect, beforeAll } from 'vitest'
import { generateLicenseKey, signLicenseJwt, verifyLicenseJwt } from './keys'

// Generate a real Ed25519 key pair for JWT tests
let privateKeyBase64: string
let publicKeyBase64: string

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

beforeAll(async () => {
  const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
  const rawPrivate = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey) as ArrayBuffer
  const rawPublic = await crypto.subtle.exportKey('spki', keyPair.publicKey) as ArrayBuffer
  privateKeyBase64 = toBase64(rawPrivate)
  publicKeyBase64 = toBase64(rawPublic)
})

describe('generateLicenseKey', () => {
  it('returns LR-XXXX-XXXX-XXXX-XXXX format', () => {
    const key = generateLicenseKey()
    expect(key).toMatch(/^LR-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  })

  it('has 4 groups of 4 alphanumeric chars separated by hyphens, prefixed with LR-', () => {
    const key = generateLicenseKey()
    const parts = key.split('-')
    expect(parts).toHaveLength(5) // LR, group1, group2, group3, group4
    expect(parts[0]).toBe('LR')
    for (let i = 1; i <= 4; i++) {
      expect(parts[i]).toHaveLength(4)
      expect(parts[i]).toMatch(/^[A-Z0-9]+$/)
    }
  })

  it('returns unique keys on each call', () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateLicenseKey()))
    expect(keys.size).toBe(100)
  })
})

describe('signLicenseJwt + verifyLicenseJwt', () => {
  it('round-trips: sign a payload, verify it, get same payload back', async () => {
    const payload = { key: 'LR-AAAA-BBBB-CCCC-DDDD', tier: 'pro', validUntil: '2027-01-01T00:00:00.000Z' }

    const jwt = await signLicenseJwt(payload, privateKeyBase64)
    const verified = await verifyLicenseJwt(jwt, publicKeyBase64)

    expect(verified).not.toBeNull()
    expect(verified!.key).toBe(payload.key)
    expect(verified!.tier).toBe(payload.tier)
    expect(verified!.validUntil).toBe(payload.validUntil)
    expect(verified!.iss).toBe('lead-routing-license-server')
    expect(typeof verified!.iat).toBe('number')
  })

  it('JWT format: 3 dot-separated base64url parts', async () => {
    const payload = { key: 'LR-TEST-TEST-TEST-TEST', tier: 'pro', validUntil: '2027-01-01T00:00:00.000Z' }
    const jwt = await signLicenseJwt(payload, privateKeyBase64)

    const parts = jwt.split('.')
    expect(parts).toHaveLength(3)

    // Each part should be base64url (only alphanumeric, dash, underscore)
    for (const part of parts) {
      expect(part).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('rejects tampered JWT (modified payload)', async () => {
    const payload = { key: 'LR-AAAA-BBBB-CCCC-DDDD', tier: 'pro', validUntil: '2027-01-01T00:00:00.000Z' }
    const jwt = await signLicenseJwt(payload, privateKeyBase64)

    // Tamper with the payload portion
    const parts = jwt.split('.')
    // Flip a character in the payload
    const tamperedPayload = parts[1].slice(0, -1) + (parts[1].slice(-1) === 'A' ? 'B' : 'A')
    const tamperedJwt = `${parts[0]}.${tamperedPayload}.${parts[2]}`

    const result = await verifyLicenseJwt(tamperedJwt, publicKeyBase64)
    expect(result).toBeNull()
  })

  it('rejects JWT with invalid signature', async () => {
    const payload = { key: 'LR-AAAA-BBBB-CCCC-DDDD', tier: 'pro', validUntil: '2027-01-01T00:00:00.000Z' }
    const jwt = await signLicenseJwt(payload, privateKeyBase64)

    // Replace signature with garbage
    const parts = jwt.split('.')
    const fakeSignature = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const badJwt = `${parts[0]}.${parts[1]}.${fakeSignature}`

    const result = await verifyLicenseJwt(badJwt, publicKeyBase64)
    expect(result).toBeNull()
  })

  it('rejects a JWT verified with the wrong public key', async () => {
    const payload = { key: 'LR-AAAA-BBBB-CCCC-DDDD', tier: 'pro', validUntil: '2027-01-01T00:00:00.000Z' }
    const jwt = await signLicenseJwt(payload, privateKeyBase64)

    // Generate a different key pair
    const otherPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
    const otherPub = await crypto.subtle.exportKey('spki', otherPair.publicKey) as ArrayBuffer
    const otherPubBase64 = toBase64(otherPub)

    const result = await verifyLicenseJwt(jwt, otherPubBase64)
    expect(result).toBeNull()
  })

  it('rejects malformed JWT strings', async () => {
    expect(await verifyLicenseJwt('not-a-jwt', publicKeyBase64)).toBeNull()
    expect(await verifyLicenseJwt('a.b', publicKeyBase64)).toBeNull()
    expect(await verifyLicenseJwt('', publicKeyBase64)).toBeNull()
  })
})
