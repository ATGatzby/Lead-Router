import { describe, it, expect } from 'vitest'
import { renderEnvWeb } from './env-web.js'

// ─── Test fixture ────────────────────────────────────────────────────────────

const fullConfig = {
  appUrl: 'https://app.example.com',
  engineUrl: 'http://engine:3001',
  publicEngineUrl: 'https://api.example.com',
  databaseUrl: 'postgresql://u:p@postgres:5432/db',
  redisUrl: 'redis://redis:6379',
  sessionSecret: 'session_secret',
  engineWebhookSecret: 'webhook_secret',
  adminSecret: 'admin_secret',
  adminEmail: 'admin@example.com',
  adminPassword: 'secureP@ss123',
  internalApiKey: 'internal_api_key_here',
}

// ─── Tests for new ADMIN_EMAIL / ADMIN_PASSWORD fields ───────────────────────

describe('renderEnvWeb — admin credentials', () => {
  it('includes ADMIN_EMAIL', () => {
    const out = renderEnvWeb(fullConfig)
    expect(out).toContain('ADMIN_EMAIL=admin@example.com')
  })

  it('includes ADMIN_PASSWORD', () => {
    const out = renderEnvWeb(fullConfig)
    expect(out).toContain('ADMIN_PASSWORD=secureP@ss123')
  })

  it('handles special characters in password', () => {
    const out = renderEnvWeb({ ...fullConfig, adminPassword: 'p@$$w0rd!#%^&' })
    expect(out).toContain('ADMIN_PASSWORD=p@$$w0rd!#%^&')
  })

  it('handles email with plus addressing', () => {
    const out = renderEnvWeb({ ...fullConfig, adminEmail: 'admin+test@example.com' })
    expect(out).toContain('ADMIN_EMAIL=admin+test@example.com')
  })

  it('ADMIN_EMAIL appears in the Admin section', () => {
    const out = renderEnvWeb(fullConfig)
    const lines = out.split('\n')
    const adminSectionIdx = lines.findIndex(l => l.includes('# Admin'))
    const emailIdx = lines.findIndex(l => l.startsWith('ADMIN_EMAIL='))
    expect(adminSectionIdx).toBeGreaterThan(-1)
    expect(emailIdx).toBeGreaterThan(adminSectionIdx)
  })
})

describe('renderEnvWeb — optional fields default to empty', () => {
  it('FEEDBACK_TO_EMAIL defaults to empty', () => {
    const out = renderEnvWeb(fullConfig)
    expect(out).toContain('FEEDBACK_TO_EMAIL=')
    // The line should end with = (empty value)
    const line = out.split('\n').find(l => l.startsWith('FEEDBACK_TO_EMAIL='))!
    expect(line).toBe('FEEDBACK_TO_EMAIL=')
  })

  it('FEEDBACK_TO_EMAIL is set when provided', () => {
    const out = renderEnvWeb({ ...fullConfig, feedbackToEmail: 'feedback@co.com' })
    expect(out).toContain('FEEDBACK_TO_EMAIL=feedback@co.com')
  })
})
