import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import validate from './validate'
import { createMockD1, makeLicense, type MockD1 } from '../test-helpers/mock-d1'

// Build a mini Hono app that mounts the validate route with a mock env
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

  // Inject mock DB via middleware
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

  app.route('/validate', validate)
  return app
}

describe('POST /validate', () => {
  let mockDb: MockD1
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    mockDb = createMockD1()
    app = createApp(mockDb)
  })

  it('valid key returns { valid: true, tier, validUntil }', async () => {
    const license = makeLicense({ key: 'LR-AAAA-BBBB-CCCC-DDDD', tier: 'pro' })
    mockDb._addLicense(license)

    const res = await app.request('/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'LR-AAAA-BBBB-CCCC-DDDD' }),
    })

    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.valid).toBe(true)
    expect(data.tier).toBe('pro')
    expect(data.validUntil).toBe(license.validUntil)
    expect(data.graceActive).toBe(false)
  })

  it('missing key returns 400 with error', async () => {
    const res = await app.request('/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(400)
    const data: any = await res.json()
    expect(data.valid).toBe(false)
    expect(data.error).toBe('License key is required')
  })

  it('unknown key returns { valid: false, error: "License not found" }', async () => {
    const res = await app.request('/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'LR-XXXX-XXXX-XXXX-XXXX' }),
    })

    expect(res.status).toBe(404)
    const data: any = await res.json()
    expect(data.valid).toBe(false)
    expect(data.error).toBe('License not found')
  })

  it('expired key (no grace period) returns { valid: false }', async () => {
    const license = makeLicense({
      key: 'LR-EXPI-REDD-KEYX-AAAA',
      validUntil: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // yesterday
      graceUntil: null,
    })
    mockDb._addLicense(license)

    const res = await app.request('/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'LR-EXPI-REDD-KEYX-AAAA' }),
    })

    expect(res.status).toBe(401)
    const data: any = await res.json()
    expect(data.valid).toBe(false)
    expect(data.error).toBe('License has expired')
  })

  it('expired key but within grace period returns { valid: true, graceActive: true }', async () => {
    const license = makeLicense({
      key: 'LR-GRAC-EKEY-AAAA-BBBB',
      validUntil: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // yesterday
      graceUntil: new Date(Date.now() + 29 * 24 * 60 * 60 * 1000).toISOString(), // 29 days from now
    })
    mockDb._addLicense(license)

    const res = await app.request('/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'LR-GRAC-EKEY-AAAA-BBBB' }),
    })

    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.valid).toBe(true)
    expect(data.graceActive).toBe(true)
    expect(data.tier).toBe('pro')
  })

  it('fingerprint binding: first call binds fingerprint', async () => {
    const license = makeLicense({
      key: 'LR-BIND-FRST-AAAA-BBBB',
      serverFingerprint: null,
    })
    mockDb._addLicense(license)

    const res = await app.request('/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'LR-BIND-FRST-AAAA-BBBB', fingerprint: 'fp-server-001' }),
    })

    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.valid).toBe(true)

    // Verify fingerprint was stored
    const stored = mockDb._licenses.get('LR-BIND-FRST-AAAA-BBBB')
    expect(stored?.serverFingerprint).toBe('fp-server-001')
  })

  it('fingerprint binding: second call with same fingerprint passes', async () => {
    const license = makeLicense({
      key: 'LR-SAME-FPXX-AAAA-BBBB',
      serverFingerprint: 'fp-server-001',
    })
    mockDb._addLicense(license)

    const res = await app.request('/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'LR-SAME-FPXX-AAAA-BBBB', fingerprint: 'fp-server-001' }),
    })

    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.valid).toBe(true)
  })

  it('fingerprint mismatch returns { valid: false, error: "License bound to different server" }', async () => {
    const license = makeLicense({
      key: 'LR-DIFF-FPXX-AAAA-BBBB',
      serverFingerprint: 'fp-server-001',
    })
    mockDb._addLicense(license)

    const res = await app.request('/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'LR-DIFF-FPXX-AAAA-BBBB', fingerprint: 'fp-server-OTHER' }),
    })

    expect(res.status).toBe(401)
    const data: any = await res.json()
    expect(data.valid).toBe(false)
    expect(data.error).toBe('License bound to different server')
  })

  it('inactive license returns { valid: false, error: "License is inactive" }', async () => {
    const license = makeLicense({
      key: 'LR-INAC-TIVE-AAAA-BBBB',
      isActive: 0,
    })
    mockDb._addLicense(license)

    const res = await app.request('/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'LR-INAC-TIVE-AAAA-BBBB' }),
    })

    expect(res.status).toBe(401)
    const data: any = await res.json()
    expect(data.valid).toBe(false)
    expect(data.error).toBe('License is inactive')
  })
})
