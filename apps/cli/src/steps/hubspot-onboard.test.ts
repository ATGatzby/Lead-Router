import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────
// Order matters: every external dependency of hubspot-onboard.ts is mocked
// BEFORE the dynamic import of the module under test.

const mocks = vi.hoisted(() => ({
  text: vi.fn(),
  syncHubspotFields: vi.fn(),
  exec: vi.fn(),
}))

vi.mock('@clack/prompts', () => ({
  text: mocks.text,
  isCancel: (v: unknown) => typeof v === 'symbol',
  log: { info: vi.fn(), warn: vi.fn(), success: vi.fn(), step: vi.fn() },
  note: vi.fn(),
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
}))

vi.mock('../utils/field-sync-client.js', () => ({
  syncHubspotFields: mocks.syncHubspotFields,
}))

vi.mock('node:child_process', () => ({ exec: mocks.exec }))

// ── Subject ──────────────────────────────────────────────────────────────────
import { hubspotOnboard } from './hubspot-onboard.js'

const APP_URL = 'https://app.example.com'
const TOKEN = 'api-token'

beforeEach(() => {
  vi.clearAllMocks()
  // Sensible defaults — each test overrides as needed.
  mocks.text.mockResolvedValue('') // user presses Enter on the manual ack prompt
  mocks.syncHubspotFields.mockResolvedValue({ ok: true, synced: 25 })

  // Skip the 2s-per-iteration polling sleep used inside bridgeAuthorize.
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: () => void) => {
    cb()
    return 0 as unknown as ReturnType<typeof setTimeout>
  }) as typeof setTimeout)

  // Default: bridge endpoint not present → fall through to manual flow,
  //          onboarding-done returns 200.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/api/cli-auth/hubspot/request')) {
        return new Response('Not found', { status: 404 })
      }
      return new Response('{}', { status: 200 })
    })
  )
})

describe('hubspotOnboard — happy path', () => {
  it('completes the full flow when everything succeeds (manual fallback)', async () => {
    const result = await hubspotOnboard({ appUrl: APP_URL, apiToken: TOKEN })

    expect(result.authorized).toBe(true)
    expect(result.onboardingDone).toBe(true)
    expect(result.fieldsSynced).toMatchObject({ ok: true, synced: 25 })

    // syncHubspotFields was invoked
    expect(mocks.syncHubspotFields).toHaveBeenCalledTimes(1)
    expect(mocks.syncHubspotFields.mock.calls[0][0]).toBe(APP_URL)
    expect(mocks.syncHubspotFields.mock.calls[0][1]).toMatchObject({ apiToken: TOKEN })
  })

  it('uses the bridge endpoint when available and polls until ok', async () => {
    let pollCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/cli-auth/hubspot/request')) {
          return new Response(
            JSON.stringify({ sessionId: 'sess-1', authUrl: `${APP_URL}/oauth?x=1` }),
            { status: 200 }
          )
        }
        if (url.includes('/api/cli-auth/hubspot/poll/sess-1')) {
          pollCount++
          if (pollCount < 2) {
            return new Response(JSON.stringify({ status: 'pending' }), { status: 200 })
          }
          return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
        }
        return new Response('{}', { status: 200 })
      })
    )

    const result = await hubspotOnboard({ appUrl: APP_URL, apiToken: TOKEN })

    expect(result.authorized).toBe(true)
    // No manual confirmation prompt was shown — bridge handled it.
    expect(mocks.text).not.toHaveBeenCalled()
    expect(pollCount).toBeGreaterThanOrEqual(2)
  })

  it('passes Bearer token + crm:hubspot body to /api/setup/onboarding-done', async () => {
    const fetchSpy = vi.fn(async (url: string, _opts?: RequestInit) => {
      if (url.includes('/api/cli-auth/hubspot/request')) {
        return new Response('Not found', { status: 404 })
      }
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    await hubspotOnboard({ appUrl: APP_URL, apiToken: TOKEN })

    const onboardingCall = fetchSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('/api/setup/onboarding-done')
    )
    expect(onboardingCall).toBeDefined()
    const opts = onboardingCall![1] as RequestInit
    const headers = opts.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(opts.body as string)).toEqual({ crm: 'hubspot' })
  })
})

describe('hubspotOnboard — license tier', () => {
  it('treats 402 from field sync as a graceful skip', async () => {
    mocks.syncHubspotFields.mockResolvedValueOnce({ ok: true, skipped: true, status: 402 })

    const result = await hubspotOnboard({ appUrl: APP_URL, apiToken: TOKEN })

    expect(result.authorized).toBe(true)
    expect(result.fieldsSynced.skipped).toBe(true)
    // Onboarding-done is still attempted and succeeds.
    expect(result.onboardingDone).toBe(true)
  })
})

describe('hubspotOnboard — failure modes', () => {
  it('returns early when the user cancels the manual ack prompt', async () => {
    mocks.text.mockResolvedValueOnce(Symbol('cancel'))

    const result = await hubspotOnboard({ appUrl: APP_URL, apiToken: TOKEN })

    expect(result.authorized).toBe(false)
    expect(result.onboardingDone).toBe(false)
    expect(mocks.syncHubspotFields).not.toHaveBeenCalled()
  })

  it('continues past field-sync failures and surfaces them in the result', async () => {
    mocks.syncHubspotFields.mockResolvedValueOnce({
      ok: false,
      error: 'HTTP 500 internal error',
    })

    const result = await hubspotOnboard({ appUrl: APP_URL, apiToken: TOKEN })

    expect(result.fieldsSynced).toMatchObject({ ok: false })
    // Onboarding-done is still attempted.
    expect(result.onboardingDone).toBe(true)
  })

  it('marks onboardingDone=false when /api/setup/onboarding-done errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/cli-auth/hubspot/request')) {
          return new Response('Not found', { status: 404 })
        }
        if (url.includes('/api/setup/onboarding-done')) {
          return new Response('boom', { status: 500 })
        }
        return new Response('{}', { status: 200 })
      })
    )

    const result = await hubspotOnboard({ appUrl: APP_URL, apiToken: TOKEN })

    expect(result.authorized).toBe(true)
    expect(result.onboardingDone).toBe(false)
  })

  it('returns ok when the bridge poll endpoint reports session expired (410)', async () => {
    // 410 short-circuits the poll loop → bridgeAuthorize returns ok:false.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/cli-auth/hubspot/request')) {
          return new Response(
            JSON.stringify({ sessionId: 'sess-1', authUrl: `${APP_URL}/oauth?x=1` }),
            { status: 200 }
          )
        }
        if (url.includes('/api/cli-auth/hubspot/poll/sess-1')) {
          return new Response('Gone', { status: 410 })
        }
        return new Response('{}', { status: 200 })
      })
    )

    const result = await hubspotOnboard({ appUrl: APP_URL, apiToken: TOKEN })

    expect(result.authorized).toBe(false)
    expect(result.onboardingDone).toBe(false)
    // Field sync should not have been attempted.
    expect(mocks.syncHubspotFields).not.toHaveBeenCalled()
  })

  it('falls back to the manual flow when the bridge endpoint is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/cli-auth/hubspot/request')) {
          throw new Error('ECONNREFUSED')
        }
        return new Response('{}', { status: 200 })
      })
    )

    const result = await hubspotOnboard({ appUrl: APP_URL, apiToken: TOKEN })

    // Manual ack prompt was shown
    expect(mocks.text).toHaveBeenCalled()
    expect(result.authorized).toBe(true)
  })
})
