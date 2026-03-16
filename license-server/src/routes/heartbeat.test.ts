import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import heartbeat from './heartbeat'
import { createMockD1, makeLicense, type MockD1 } from '../test-helpers/mock-d1'

function createApp(mockDb: MockD1) {
  const app = new Hono<{
    Bindings: {
      DB: any
      STRIPE_SECRET_KEY: string
      STRIPE_WEBHOOK_SECRET: string
      RESEND_API_KEY: string
      ED25519_PRIVATE_KEY: string
      ED25519_PUBLIC_KEY: string
    }
  }>()

  app.use('*', async (c, next) => {
    c.env = {
      DB: mockDb,
      STRIPE_SECRET_KEY: 'sk_test',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      RESEND_API_KEY: 're_test',
      ED25519_PRIVATE_KEY: 'test-priv',
      ED25519_PUBLIC_KEY: 'test-pub',
    }
    await next()
  })

  app.route('/heartbeat', heartbeat)
  return app
}

describe('POST /heartbeat', () => {
  let mockDb: MockD1
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    mockDb = createMockD1()
    app = createApp(mockDb)
  })

  it('valid key + fingerprint returns { valid: true } and updates lastHeartbeat', async () => {
    const license = makeLicense({
      key: 'LR-HBVL-IDKX-AAAA-BBBB',
      serverFingerprint: 'fp-001',
    })
    mockDb._addLicense(license)

    const res = await app.request('/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'LR-HBVL-IDKX-AAAA-BBBB', fingerprint: 'fp-001' }),
    })

    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.valid).toBe(true)
    expect(data.tier).toBe('pro')
    expect(data.graceActive).toBe(false)

    // Verify heartbeat was updated
    const stored = mockDb._licenses.get('LR-HBVL-IDKX-AAAA-BBBB')
    expect(stored?.lastHeartbeat).not.toBeNull()
  })

  it('missing key or fingerprint returns 400', async () => {
    const res = await app.request('/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'LR-TEST-MISS-FPXX-AAAA' }),
    })

    expect(res.status).toBe(400)
    const data: any = await res.json()
    expect(data.valid).toBe(false)
    expect(data.error).toBe('key and fingerprint are required')
  })

  it('invalid key returns { valid: false }', async () => {
    const res = await app.request('/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'LR-DOES-NTEX-ISTX-AAAA', fingerprint: 'fp-001' }),
    })

    expect(res.status).toBe(404)
    const data: any = await res.json()
    expect(data.valid).toBe(false)
    expect(data.error).toBe('License not found')
  })

  it('inactive license returns { valid: false }', async () => {
    const license = makeLicense({
      key: 'LR-HBIN-ACTV-AAAA-BBBB',
      serverFingerprint: 'fp-001',
      isActive: 0,
    })
    mockDb._addLicense(license)

    const res = await app.request('/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'LR-HBIN-ACTV-AAAA-BBBB', fingerprint: 'fp-001' }),
    })

    expect(res.status).toBe(401)
    const data: any = await res.json()
    expect(data.valid).toBe(false)
    expect(data.error).toBe('License is inactive')
  })

  it('expired beyond grace returns { valid: true, tier: "free" } (downgrade)', async () => {
    const license = makeLicense({
      key: 'LR-HBLP-SEDK-AAAA-BBBB',
      serverFingerprint: 'fp-001',
      validUntil: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days ago
      graceUntil: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago (grace expired)
    })
    mockDb._addLicense(license)

    const res = await app.request('/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'LR-HBLP-SEDK-AAAA-BBBB', fingerprint: 'fp-001' }),
    })

    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.valid).toBe(true)
    expect(data.tier).toBe('free')
    expect(data.graceActive).toBe(false)
  })

  it('expired but within grace period returns { valid: true, graceActive: true }', async () => {
    const license = makeLicense({
      key: 'LR-HBGR-ACEX-AAAA-BBBB',
      serverFingerprint: 'fp-001',
      validUntil: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
      graceUntil: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString(), // 25 days from now
    })
    mockDb._addLicense(license)

    const res = await app.request('/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'LR-HBGR-ACEX-AAAA-BBBB', fingerprint: 'fp-001' }),
    })

    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.valid).toBe(true)
    expect(data.tier).toBe('pro')
    expect(data.graceActive).toBe(true)
  })

  it('fingerprint mismatch returns error', async () => {
    const license = makeLicense({
      key: 'LR-HBFP-MISS-AAAA-BBBB',
      serverFingerprint: 'fp-original',
    })
    mockDb._addLicense(license)

    const res = await app.request('/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'LR-HBFP-MISS-AAAA-BBBB', fingerprint: 'fp-different' }),
    })

    expect(res.status).toBe(401)
    const data: any = await res.json()
    expect(data.valid).toBe(false)
    expect(data.error).toBe('License bound to different server')
  })

  it('first heartbeat binds fingerprint if not yet set', async () => {
    const license = makeLicense({
      key: 'LR-HBBN-DFPX-AAAA-BBBB',
      serverFingerprint: null,
    })
    mockDb._addLicense(license)

    const res = await app.request('/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'LR-HBBN-DFPX-AAAA-BBBB', fingerprint: 'fp-new-server' }),
    })

    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.valid).toBe(true)

    const stored = mockDb._licenses.get('LR-HBBN-DFPX-AAAA-BBBB')
    expect(stored?.serverFingerprint).toBe('fp-new-server')
  })
})
