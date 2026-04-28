import { describe, it, expect, vi } from 'vitest'
import { syncFields, syncHubspotFields } from './field-sync-client.js'

function mockFetch(status: number, body: unknown, ok = status < 400) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response)
}

describe('syncFields()', () => {
  it('returns synced count on 200', async () => {
    const f = mockFetch(200, { synced: 42, objectType: 'LEAD' })
    const r = await syncFields('https://app.example.com', 'LEAD', {
      apiToken: 't',
      fetchImpl: f as unknown as typeof fetch,
    })
    expect(r.ok).toBe(true)
    expect(r.synced).toBe(42)
    expect(r.skipped).toBeUndefined()
  })

  it('sends Bearer auth + JSON content-type', async () => {
    const f = mockFetch(200, { synced: 1 })
    await syncFields('https://app.example.com', 'LEAD', {
      apiToken: 'mytoken',
      fetchImpl: f as unknown as typeof fetch,
    })
    const opts = f.mock.calls[0][1] as RequestInit
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer mytoken')
    expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('forwards X-Sfdc-Org-Id when provided', async () => {
    const f = mockFetch(200, { synced: 1 })
    await syncFields('https://app.example.com', 'CONTACT', {
      apiToken: 't',
      sfdcOrgId: '00D0xx',
      fetchImpl: f as unknown as typeof fetch,
    })
    const opts = f.mock.calls[0][1] as RequestInit
    expect((opts.headers as Record<string, string>)['X-Sfdc-Org-Id']).toBe('00D0xx')
  })

  it('encodes object type into query string', async () => {
    const f = mockFetch(200, { synced: 1 })
    await syncFields('https://app.example.com', 'CONTACT', {
      apiToken: 't',
      fetchImpl: f as unknown as typeof fetch,
    })
    const url = f.mock.calls[0][0] as string
    expect(url).toContain('object=CONTACT')
  })

  it('strips trailing slash from appUrl', async () => {
    const f = mockFetch(200, { synced: 1 })
    await syncFields('https://app.example.com///', 'LEAD', {
      apiToken: 't',
      fetchImpl: f as unknown as typeof fetch,
    })
    const url = f.mock.calls[0][0] as string
    expect(url.startsWith('https://app.example.com/api/fields/sync')).toBe(true)
  })

  it('returns skipped=true on 402 (license tier)', async () => {
    const f = mockFetch(402, { error: 'upgrade required' }, false)
    const r = await syncFields('https://app.example.com', 'CONTACT', {
      apiToken: 't',
      fetchImpl: f as unknown as typeof fetch,
    })
    expect(r.ok).toBe(true)
    expect(r.skipped).toBe(true)
    expect(r.status).toBe(402)
  })

  it('surfaces 401 with a helpful message about Bearer auth', async () => {
    const f = mockFetch(401, 'Unauthorized', false)
    const r = await syncFields('https://app.example.com', 'LEAD', {
      apiToken: 't',
      fetchImpl: f as unknown as typeof fetch,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Bearer auth rejected/)
  })

  it('surfaces other 4xx errors with body text', async () => {
    const f = mockFetch(400, 'bad request body', false)
    const r = await syncFields('https://app.example.com', 'LEAD', {
      apiToken: 't',
      fetchImpl: f as unknown as typeof fetch,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/HTTP 400/)
    expect(r.error).toMatch(/bad request body/)
  })

  it('returns ok:false (not throw) on network error', async () => {
    const f = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const r = await syncFields('https://app.example.com', 'LEAD', {
      apiToken: 't',
      fetchImpl: f as unknown as typeof fetch,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Network error/)
  })
})

describe('syncHubspotFields()', () => {
  it('returns synced total on 200', async () => {
    const f = mockFetch(200, { total: 100 })
    const r = await syncHubspotFields('https://app.example.com', {
      apiToken: 't',
      fetchImpl: f as unknown as typeof fetch,
    })
    expect(r.ok).toBe(true)
    expect(r.synced).toBe(100)
  })

  it('returns skipped on 402', async () => {
    const f = mockFetch(402, { error: 'upgrade' }, false)
    const r = await syncHubspotFields('https://app.example.com', {
      apiToken: 't',
      fetchImpl: f as unknown as typeof fetch,
    })
    expect(r.skipped).toBe(true)
  })

  it('hits the hubspot fields endpoint', async () => {
    const f = mockFetch(200, { total: 10 })
    await syncHubspotFields('https://app.example.com', {
      apiToken: 't',
      fetchImpl: f as unknown as typeof fetch,
    })
    const url = f.mock.calls[0][0] as string
    expect(url).toContain('/api/integrations/hubspot/fields')
  })
})
