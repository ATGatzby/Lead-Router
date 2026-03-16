import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getLicenseTier, getTierLimits, upgradeRequiredResponse } from './license.js'

// ─── getLicenseTier ──────────────────────────────────────────────────────────

describe('getLicenseTier', () => {
  const originalEnv = process.env.LICENSE_TIER

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.LICENSE_TIER
    } else {
      process.env.LICENSE_TIER = originalEnv
    }
  })

  it('returns "free" when LICENSE_TIER env is not set', () => {
    delete process.env.LICENSE_TIER
    expect(getLicenseTier()).toBe('free')
  })

  it('returns "free" when LICENSE_TIER is "free"', () => {
    process.env.LICENSE_TIER = 'free'
    expect(getLicenseTier()).toBe('free')
  })

  it('returns "pro" when LICENSE_TIER is "pro"', () => {
    process.env.LICENSE_TIER = 'pro'
    expect(getLicenseTier()).toBe('pro')
  })

  it('returns "free" for any invalid value', () => {
    process.env.LICENSE_TIER = 'enterprise'
    expect(getLicenseTier()).toBe('free')
  })

  it('returns "free" for empty string', () => {
    process.env.LICENSE_TIER = ''
    expect(getLicenseTier()).toBe('free')
  })
})

// ─── getTierLimits ───────────────────────────────────────────────────────────

describe('getTierLimits', () => {
  it('returns correct free tier limits', () => {
    const limits = getTierLimits('free')
    expect(limits).toEqual({
      maxRules: 2,
      maxOrgs: 1,
      maxSeats: 3,
      allowedTriggers: ['LEAD'],
      weightedDistribution: false,
      analytics: false,
      auditLog: false,
    })
  })

  it('returns correct pro tier limits', () => {
    const limits = getTierLimits('pro')
    expect(limits).toEqual({
      maxRules: Infinity,
      maxOrgs: 1,
      maxSeats: Infinity,
      allowedTriggers: ['LEAD', 'CONTACT', 'ACCOUNT'],
      weightedDistribution: true,
      analytics: true,
      auditLog: true,
    })
  })

  it('defaults to getLicenseTier() when no argument passed', () => {
    delete process.env.LICENSE_TIER
    const limits = getTierLimits()
    expect(limits.maxRules).toBe(2) // free tier
  })

  it('pro tier allows LEAD, CONTACT, and ACCOUNT triggers', () => {
    const limits = getTierLimits('pro')
    expect(limits.allowedTriggers).toContain('LEAD')
    expect(limits.allowedTriggers).toContain('CONTACT')
    expect(limits.allowedTriggers).toContain('ACCOUNT')
  })

  it('free tier only allows LEAD trigger', () => {
    const limits = getTierLimits('free')
    expect(limits.allowedTriggers).toHaveLength(1)
    expect(limits.allowedTriggers).toContain('LEAD')
  })
})

// ─── upgradeRequiredResponse ─────────────────────────────────────────────────

describe('upgradeRequiredResponse', () => {
  it('returns a Response with status 402', () => {
    const resp = upgradeRequiredResponse('weighted distribution')
    expect(resp.status).toBe(402)
  })

  it('response body contains error: "upgrade_required"', async () => {
    const resp = upgradeRequiredResponse('analytics')
    const body = await resp.json()
    expect(body.error).toBe('upgrade_required')
  })

  it('response body contains the feature name in the message', async () => {
    const resp = upgradeRequiredResponse('audit log')
    const body = await resp.json()
    expect(body.message).toContain('audit log')
  })

  it('response body contains tier: "free"', async () => {
    const resp = upgradeRequiredResponse('analytics')
    const body = await resp.json()
    expect(body.tier).toBe('free')
  })

  it('response body message includes pricing URL', async () => {
    const resp = upgradeRequiredResponse('analytics')
    const body = await resp.json()
    expect(body.message).toContain('https://openedgeai.tech/pricing')
  })
})
