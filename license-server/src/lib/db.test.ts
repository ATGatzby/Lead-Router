import { describe, it, expect } from 'vitest'
import * as db from './db'

describe('db exports', () => {
  it('exports findLicenseByKey function', () => {
    expect(typeof db.findLicenseByKey).toBe('function')
  })

  it('exports findLicenseBySubscriptionId function', () => {
    expect(typeof db.findLicenseBySubscriptionId).toBe('function')
  })

  it('exports createLicense function', () => {
    expect(typeof db.createLicense).toBe('function')
  })

  it('exports updateLicenseHeartbeat function', () => {
    expect(typeof db.updateLicenseHeartbeat).toBe('function')
  })

  it('exports updateLicenseFingerprint function', () => {
    expect(typeof db.updateLicenseFingerprint).toBe('function')
  })

  it('exports extendLicenseValidity function', () => {
    expect(typeof db.extendLicenseValidity).toBe('function')
  })

  it('exports setGracePeriod function', () => {
    expect(typeof db.setGracePeriod).toBe('function')
  })

  it('exports License interface (type only, verified by TypeScript)', () => {
    // TypeScript compile-time check — if this compiles, the interface exists
    const license: db.License = {
      id: 'test-id',
      key: 'LR-TEST-TEST-TEST-TEST',
      jwt: 'header.payload.sig',
      email: 'test@example.com',
      tier: 'pro',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      validUntil: '2027-01-01T00:00:00.000Z',
      graceUntil: null,
      serverFingerprint: null,
      lastHeartbeat: null,
      isActive: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    expect(license.key).toBe('LR-TEST-TEST-TEST-TEST')
  })

  it('exports CreateLicenseData interface (type only, verified by TypeScript)', () => {
    const data: db.CreateLicenseData = {
      id: 'test-id',
      key: 'LR-TEST-TEST-TEST-TEST',
      jwt: 'header.payload.sig',
      email: 'test@example.com',
      tier: 'pro',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      validUntil: '2027-01-01T00:00:00.000Z',
    }
    expect(data.email).toBe('test@example.com')
  })
})
