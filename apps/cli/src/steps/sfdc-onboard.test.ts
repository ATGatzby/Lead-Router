import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────
// Order matters: every external dependency of sfdc-onboard.ts is mocked
// BEFORE the dynamic import of the module under test.

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  loginViaAppBridge: vi.fn(),
  sfdcDeployInline: vi.fn(),
  syncFields: vi.fn(),
  exec: vi.fn(),
}))

vi.mock('@clack/prompts', () => ({
  confirm: mocks.confirm,
  isCancel: (v: unknown) => typeof v === 'symbol',
  log: { info: vi.fn(), warn: vi.fn(), success: vi.fn(), step: vi.fn() },
  note: vi.fn(),
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
}))

vi.mock('./sfdc-deploy-inline.js', () => ({
  loginViaAppBridge: mocks.loginViaAppBridge,
  sfdcDeployInline: mocks.sfdcDeployInline,
}))

vi.mock('../utils/field-sync-client.js', () => ({
  syncFields: mocks.syncFields,
}))

vi.mock('node:child_process', () => ({ exec: mocks.exec }))

// ── Subject ──────────────────────────────────────────────────────────────────
import { sfdcOnboard } from './sfdc-onboard.js'

const APP_URL = 'https://app.example.com'
const ENGINE_URL = 'https://engine.example.com'
const TOKEN = 'api-token'

beforeEach(() => {
  vi.clearAllMocks()
  // Sensible defaults — each test overrides as needed
  mocks.confirm.mockResolvedValue(true)
  mocks.loginViaAppBridge.mockResolvedValue({
    accessToken: 'sfdc-access',
    instanceUrl: 'https://acme.my.salesforce.com',
    sfdcOrgId: '00DTest',
  })
  mocks.sfdcDeployInline.mockResolvedValue(undefined)
  mocks.syncFields.mockResolvedValue({ ok: true, synced: 10 })

  // Default: status endpoint says not yet onboarded; setup endpoints say OK.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/api/setup/status')) {
        return new Response(JSON.stringify({ connected: false, onboardingDone: false }), {
          status: 200,
        })
      }
      return new Response('{}', { status: 200 })
    })
  )
})

describe('sfdcOnboard — happy path', () => {
  it('completes the full flow when everything succeeds', async () => {
    const result = await sfdcOnboard({
      appUrl: APP_URL,
      engineUrl: ENGINE_URL,
      apiToken: TOKEN,
      licenseTier: 'pro',
    })

    expect(result.sfdcOrgId).toBe('00DTest')
    expect(result.onboardingDone).toBe(true)
    expect(result.testEventSent).toBe(true)

    // All 3 objects synced on Pro tier
    expect(mocks.syncFields).toHaveBeenCalledTimes(3)
    expect(mocks.syncFields.mock.calls.map((c) => c[1])).toEqual(['LEAD', 'CONTACT', 'ACCOUNT'])

    // Deploy was invoked with reused tokens
    expect(mocks.sfdcDeployInline).toHaveBeenCalledTimes(1)
    expect(mocks.sfdcDeployInline.mock.calls[0][0]).toMatchObject({
      auth: { accessToken: 'sfdc-access', instanceUrl: 'https://acme.my.salesforce.com' },
    })
  })

  it('passes Bearer + X-Sfdc-Org-Id when calling /api/setup/onboarding-done', async () => {
    const fetchSpy = vi.fn(async (url: string, opts?: RequestInit) => {
      if (url.includes('/api/setup/status')) {
        return new Response(JSON.stringify({ connected: false, onboardingDone: false }), {
          status: 200,
        })
      }
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    await sfdcOnboard({
      appUrl: APP_URL,
      engineUrl: ENGINE_URL,
      apiToken: TOKEN,
      licenseTier: 'pro',
    })

    const onboardingCall = fetchSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('/api/setup/onboarding-done')
    )
    expect(onboardingCall).toBeDefined()
    const headers = (onboardingCall![1] as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(headers['X-Sfdc-Org-Id']).toBe('00DTest')
  })
})

describe('sfdcOnboard — license tier', () => {
  it('skips CONTACT and ACCOUNT on free tier without calling syncFields', async () => {
    const result = await sfdcOnboard({
      appUrl: APP_URL,
      engineUrl: ENGINE_URL,
      apiToken: TOKEN,
      licenseTier: 'free',
    })

    // syncFields only called for LEAD
    expect(mocks.syncFields).toHaveBeenCalledTimes(1)
    expect(mocks.syncFields.mock.calls[0][1]).toBe('LEAD')

    expect(result.fieldsSynced.CONTACT).toEqual({ ok: true, skipped: true })
    expect(result.fieldsSynced.ACCOUNT).toEqual({ ok: true, skipped: true })
  })

  it('honors a 402 response from the field-sync client (Pro plan but tier-blocked)', async () => {
    mocks.syncFields
      .mockResolvedValueOnce({ ok: true, synced: 50 }) // LEAD
      .mockResolvedValueOnce({ ok: true, skipped: true, status: 402 }) // CONTACT
      .mockResolvedValueOnce({ ok: true, skipped: true, status: 402 }) // ACCOUNT

    const result = await sfdcOnboard({
      appUrl: APP_URL,
      engineUrl: ENGINE_URL,
      apiToken: TOKEN,
      licenseTier: 'pro',
    })

    expect(result.fieldsSynced.LEAD).toMatchObject({ ok: true, synced: 50 })
    expect(result.fieldsSynced.CONTACT).toMatchObject({ skipped: true })
    expect(result.fieldsSynced.ACCOUNT).toMatchObject({ skipped: true })
  })
})

describe('sfdcOnboard — idempotency', () => {
  it('skips deploy when /api/setup/status reports already onboarded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/setup/status')) {
          return new Response(JSON.stringify({ connected: true, onboardingDone: true }), {
            status: 200,
          })
        }
        return new Response('{}', { status: 200 })
      })
    )

    await sfdcOnboard({
      appUrl: APP_URL,
      engineUrl: ENGINE_URL,
      apiToken: TOKEN,
      licenseTier: 'pro',
    })

    expect(mocks.sfdcDeployInline).not.toHaveBeenCalled()
    // Still does field sync + onboarding-done — this is fine; both endpoints
    // are idempotent.
    expect(mocks.syncFields).toHaveBeenCalled()
  })
})

describe('sfdcOnboard — failure modes', () => {
  it('returns early when user declines package install', async () => {
    mocks.confirm.mockResolvedValueOnce(false)
    const result = await sfdcOnboard({
      appUrl: APP_URL,
      engineUrl: ENGINE_URL,
      apiToken: TOKEN,
      licenseTier: 'free',
    })

    expect(result.onboardingDone).toBe(false)
    expect(mocks.loginViaAppBridge).not.toHaveBeenCalled()
    expect(mocks.sfdcDeployInline).not.toHaveBeenCalled()
  })

  it('throws when OAuth bridge fails', async () => {
    mocks.loginViaAppBridge.mockRejectedValueOnce(new Error('CLI auth session expired'))
    await expect(
      sfdcOnboard({
        appUrl: APP_URL,
        engineUrl: ENGINE_URL,
        apiToken: TOKEN,
        licenseTier: 'free',
      })
    ).rejects.toThrow(/Salesforce OAuth/)
  })

  it('throws when sfdcDeployInline fails (deploy is required)', async () => {
    mocks.sfdcDeployInline.mockRejectedValueOnce(new Error('component missing'))
    await expect(
      sfdcOnboard({
        appUrl: APP_URL,
        engineUrl: ENGINE_URL,
        apiToken: TOKEN,
        licenseTier: 'free',
      })
    ).rejects.toThrow(/Salesforce package deploy failed/)
  })

  it('continues past field-sync failures and surfaces them in the result', async () => {
    mocks.syncFields.mockResolvedValueOnce({
      ok: false,
      error: 'HTTP 401 Bearer auth not deployed yet',
    })

    const result = await sfdcOnboard({
      appUrl: APP_URL,
      engineUrl: ENGINE_URL,
      apiToken: TOKEN,
      licenseTier: 'free',
    })

    expect(result.fieldsSynced.LEAD).toMatchObject({ ok: false })
    // Onboarding-done was still attempted
    expect(result.onboardingDone).toBe(true)
  })

  it('marks testEventSent=false when /api/setup/test-event 404s', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/setup/status')) {
          return new Response(
            JSON.stringify({ connected: false, onboardingDone: false }),
            { status: 200 }
          )
        }
        if (url.includes('/api/setup/test-event')) {
          return new Response('Not found', { status: 404 })
        }
        return new Response('{}', { status: 200 })
      })
    )

    const result = await sfdcOnboard({
      appUrl: APP_URL,
      engineUrl: ENGINE_URL,
      apiToken: TOKEN,
      licenseTier: 'free',
    })
    expect(result.testEventSent).toBe(false)
    expect(result.onboardingDone).toBe(true)
  })

  it('respects skipTestEvent', async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes('/api/setup/status')) {
        return new Response(
          JSON.stringify({ connected: false, onboardingDone: false }),
          { status: 200 }
        )
      }
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    await sfdcOnboard({
      appUrl: APP_URL,
      engineUrl: ENGINE_URL,
      apiToken: TOKEN,
      licenseTier: 'free',
      skipTestEvent: true,
    })

    const calls = fetchSpy.mock.calls.map((c) => c[0] as string)
    expect(calls.some((u) => u.includes('test-event'))).toBe(false)
  })
})
