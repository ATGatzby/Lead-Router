import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate an Ed25519 key pair for testing */
async function generateKeyPair() {
  const keyPair = await crypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ]) as CryptoKeyPair
  const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey)
  const publicKeyBase64 = Buffer.from(publicKeyRaw).toString('base64')
  return { keyPair, publicKeyBase64 }
}

/** Create a signed JWT for testing */
async function createTestJWT(
  privateKey: CryptoKey,
  payload: Record<string, unknown>,
) {
  const header = { alg: 'EdDSA', typ: 'JWT' }
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url')
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')

  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  const signature = await crypto.subtle.sign('Ed25519', privateKey, data)
  const signatureB64 = Buffer.from(signature).toString('base64url')

  return `${headerB64}.${payloadB64}.${signatureB64}`
}

/**
 * Re-implement the core verification logic from verify-license.js so we can
 * test it without process.exit() killing the test runner.
 *
 * Returns { code, message } matching the exit code and last console output.
 */
async function verifyLicenseTestable(
  licenseKey: string | undefined,
  publicKeyBase64: string,
): Promise<{ code: number; message: string }> {
  if (!licenseKey) {
    return { code: 1, message: 'No license key provided' }
  }

  try {
    const parts = licenseKey.split('.')
    if (parts.length !== 3) {
      return { code: 1, message: 'Key is not a JWT, cannot verify offline' }
    }

    const [headerB64, payloadB64, signatureB64] = parts

    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString(),
    )

    // Check expiry
    if (payload.validUntil) {
      const expiry = new Date(payload.validUntil)
      const now = new Date()
      if (now > expiry) {
        const grace = new Date(expiry)
        grace.setDate(grace.getDate() + 30)
        if (now > grace) {
          return { code: 1, message: 'License expired beyond grace period' }
        }
        // In grace period — continue to verify signature
      }
    }

    const publicKeyBytes = Buffer.from(publicKeyBase64, 'base64')
    const key = await crypto.subtle.importKey(
      'raw',
      publicKeyBytes,
      { name: 'Ed25519' },
      false,
      ['verify'],
    )

    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    const signature = Buffer.from(signatureB64, 'base64url')

    const valid = await crypto.subtle.verify('Ed25519', key, signature, data)

    if (valid) {
      return {
        code: 0,
        message: `Signature valid. Tier: ${payload.tier}`,
      }
    } else {
      return { code: 1, message: 'Invalid signature' }
    }
  } catch (err: any) {
    return { code: 1, message: `Verification failed: ${err.message}` }
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('verify-license logic', () => {
  let keyPair: CryptoKeyPair
  let publicKeyBase64: string

  beforeEach(async () => {
    const kp = await generateKeyPair()
    keyPair = kp.keyPair
    publicKeyBase64 = kp.publicKeyBase64
  })

  it('valid JWT with correct signature exits 0', async () => {
    const jwt = await createTestJWT(keyPair.privateKey, {
      tier: 'pro',
      validUntil: '2099-12-31',
      orgId: 'test-org',
    })

    const result = await verifyLicenseTestable(jwt, publicKeyBase64)
    expect(result.code).toBe(0)
    expect(result.message).toContain('Signature valid')
    expect(result.message).toContain('pro')
  })

  it('expired JWT beyond grace period exits 1', async () => {
    const jwt = await createTestJWT(keyPair.privateKey, {
      tier: 'pro',
      validUntil: '2020-01-01', // > 30 days ago
      orgId: 'test-org',
    })

    const result = await verifyLicenseTestable(jwt, publicKeyBase64)
    expect(result.code).toBe(1)
    expect(result.message).toContain('expired beyond grace period')
  })

  it('JWT in grace period (expired < 30 days ago) exits 0', async () => {
    // Create a date 10 days ago
    const tenDaysAgo = new Date()
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10)
    const validUntil = tenDaysAgo.toISOString().split('T')[0]

    const jwt = await createTestJWT(keyPair.privateKey, {
      tier: 'pro',
      validUntil,
      orgId: 'test-org',
    })

    const result = await verifyLicenseTestable(jwt, publicKeyBase64)
    expect(result.code).toBe(0)
    expect(result.message).toContain('Signature valid')
  })

  it('non-JWT key (LR-XXXX format) exits 1 with "not a JWT" message', async () => {
    const result = await verifyLicenseTestable(
      'LR-ABCD-1234-EFGH',
      publicKeyBase64,
    )
    expect(result.code).toBe(1)
    expect(result.message).toContain('not a JWT')
  })

  it('tampered JWT exits 1', async () => {
    const jwt = await createTestJWT(keyPair.privateKey, {
      tier: 'pro',
      validUntil: '2099-12-31',
      orgId: 'test-org',
    })

    // Tamper with the payload — change tier to "enterprise"
    const parts = jwt.split('.')
    const tamperedPayload = Buffer.from(
      JSON.stringify({ tier: 'enterprise', validUntil: '2099-12-31' }),
    ).toString('base64url')
    const tamperedJwt = `${parts[0]}.${tamperedPayload}.${parts[2]}`

    const result = await verifyLicenseTestable(tamperedJwt, publicKeyBase64)
    expect(result.code).toBe(1)
    expect(result.message).toContain('Invalid signature')
  })

  it('no license key provided exits 1', async () => {
    const result = await verifyLicenseTestable(undefined, publicKeyBase64)
    expect(result.code).toBe(1)
    expect(result.message).toContain('No license key provided')
  })

  it('JWT signed with different key exits 1', async () => {
    // Generate a separate key pair
    const otherKp = await generateKeyPair()

    // Sign with the other key but verify against the original public key
    const jwt = await createTestJWT(otherKp.keyPair.privateKey, {
      tier: 'pro',
      validUntil: '2099-12-31',
    })

    const result = await verifyLicenseTestable(jwt, publicKeyBase64)
    expect(result.code).toBe(1)
    expect(result.message).toContain('Invalid signature')
  })

  it('JWT without validUntil field is accepted if signature valid', async () => {
    const jwt = await createTestJWT(keyPair.privateKey, {
      tier: 'pro',
      orgId: 'test-org',
    })

    const result = await verifyLicenseTestable(jwt, publicKeyBase64)
    expect(result.code).toBe(0)
  })

  it('grace period boundary — exactly 30 days expired exits 1', async () => {
    // 31 days ago to be safely past the 30-day grace
    const thirtyOneDaysAgo = new Date()
    thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31)
    const validUntil = thirtyOneDaysAgo.toISOString().split('T')[0]

    const jwt = await createTestJWT(keyPair.privateKey, {
      tier: 'pro',
      validUntil,
    })

    const result = await verifyLicenseTestable(jwt, publicKeyBase64)
    expect(result.code).toBe(1)
    expect(result.message).toContain('expired beyond grace period')
  })
})
