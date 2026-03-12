import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SalesforceApi, DuplicateError } from './sfdc-api.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockFetch(status: number, body: unknown, ok = status < 400) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  })
}

const INSTANCE = 'https://myorg.my.salesforce.com'
const TOKEN = 'test-access-token'
const BASE = `${INSTANCE}/services/data/v59.0`

let sf: SalesforceApi

beforeEach(() => {
  sf = new SalesforceApi(INSTANCE, TOKEN)
  vi.restoreAllMocks()
})

// ─── Constructor ─────────────────────────────────────────────────────────────

describe('SalesforceApi constructor', () => {
  it('strips trailing slashes from instanceUrl', () => {
    const api = new SalesforceApi('https://example.com///', TOKEN)
    // Verify via a query call URL
    const spy = mockFetch(200, { records: [] })
    vi.stubGlobal('fetch', spy)
    api.query('SELECT Id FROM Account')
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('https://example.com/services/data/v59.0/query'),
      expect.anything()
    )
  })
})

// ─── query() ─────────────────────────────────────────────────────────────────

describe('query()', () => {
  it('returns records from a successful SOQL query', async () => {
    const records = [{ Id: '001xx', Name: 'Acme' }]
    vi.stubGlobal('fetch', mockFetch(200, { records }))

    const result = await sf.query('SELECT Id, Name FROM Account')
    expect(result).toEqual(records)
  })

  it('URL-encodes the SOQL query', async () => {
    const spy = mockFetch(200, { records: [] })
    vi.stubGlobal('fetch', spy)

    await sf.query("SELECT Id FROM Account WHERE Name = 'Acme Corp'")
    const url = spy.mock.calls[0][0] as string
    expect(url).toContain(encodeURIComponent("SELECT Id FROM Account WHERE Name = 'Acme Corp'"))
  })

  it('includes Authorization header', async () => {
    const spy = mockFetch(200, { records: [] })
    vi.stubGlobal('fetch', spy)

    await sf.query('SELECT Id FROM Account')
    const opts = spy.mock.calls[0][1] as RequestInit
    expect(opts.headers).toHaveProperty('Authorization', `Bearer ${TOKEN}`)
  })

  it('throws on non-OK response', async () => {
    vi.stubGlobal('fetch', mockFetch(400, 'Bad SOQL', false))
    await expect(sf.query('BAD QUERY')).rejects.toThrow('SOQL query failed (400)')
  })
})

// ─── create() ────────────────────────────────────────────────────────────────

describe('create()', () => {
  it('returns the new record ID', async () => {
    vi.stubGlobal('fetch', mockFetch(201, { id: '001xx000001' }))

    const id = await sf.create('Account', { Name: 'Test' })
    expect(id).toBe('001xx000001')
  })

  it('POSTs to the correct sobject URL', async () => {
    const spy = mockFetch(201, { id: '001xx' })
    vi.stubGlobal('fetch', spy)

    await sf.create('Lead', { LastName: 'Doe' })
    expect(spy).toHaveBeenCalledWith(
      `${BASE}/sobjects/Lead`,
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('sends JSON body', async () => {
    const spy = mockFetch(201, { id: '001xx' })
    vi.stubGlobal('fetch', spy)

    await sf.create('Account', { Name: 'Test', Website: 'https://test.com' })
    const opts = spy.mock.calls[0][1] as RequestInit
    expect(JSON.parse(opts.body as string)).toEqual({ Name: 'Test', Website: 'https://test.com' })
  })

  it('throws DuplicateError when Salesforce returns duplicate', async () => {
    vi.stubGlobal('fetch', mockFetch(400, 'Duplicate value found', false))
    await expect(sf.create('PermissionSetAssignment', {})).rejects.toThrow(DuplicateError)
  })

  it('throws generic error for non-duplicate failures', async () => {
    vi.stubGlobal('fetch', mockFetch(400, 'Required field missing', false))
    await expect(sf.create('Account', {})).rejects.toThrow('Create Account failed (400)')
  })
})

// ─── update() ────────────────────────────────────────────────────────────────

describe('update()', () => {
  it('PATCHes the correct URL', async () => {
    const spy = mockFetch(204, '')
    vi.stubGlobal('fetch', spy)

    await sf.update('Account', '001xx', { Name: 'Updated' })
    expect(spy).toHaveBeenCalledWith(
      `${BASE}/sobjects/Account/001xx`,
      expect.objectContaining({ method: 'PATCH' })
    )
  })

  it('throws on failure', async () => {
    vi.stubGlobal('fetch', mockFetch(404, 'Record not found', false))
    await expect(sf.update('Account', 'bad-id', {})).rejects.toThrow('Update Account/bad-id failed (404)')
  })
})

// ─── getCurrentUserId() ──────────────────────────────────────────────────────

describe('getCurrentUserId()', () => {
  it('returns user_id from userinfo endpoint', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { user_id: '005xx000001' }))

    const id = await sf.getCurrentUserId()
    expect(id).toBe('005xx000001')
  })

  it('calls the OAuth userinfo endpoint', async () => {
    const spy = mockFetch(200, { user_id: '005xx' })
    vi.stubGlobal('fetch', spy)

    await sf.getCurrentUserId()
    expect(spy).toHaveBeenCalledWith(
      `${INSTANCE}/services/oauth2/userinfo`,
      expect.objectContaining({ headers: { Authorization: `Bearer ${TOKEN}` } })
    )
  })

  it('throws on failure', async () => {
    vi.stubGlobal('fetch', mockFetch(401, 'Unauthorized', false))
    await expect(sf.getCurrentUserId()).rejects.toThrow('Get current user failed (401)')
  })
})

// ─── deployMetadata() ────────────────────────────────────────────────────────

describe('deployMetadata()', () => {
  it('POSTs multipart form data to deploy endpoint', async () => {
    const spy = mockFetch(200, { id: '0Afxx000001' })
    vi.stubGlobal('fetch', spy)

    const zip = Buffer.from('fake-zip-content')
    const id = await sf.deployMetadata(zip)

    expect(id).toBe('0Afxx000001')
    expect(spy).toHaveBeenCalledWith(
      `${BASE}/metadata/deployRequest`,
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('sets multipart content-type with boundary', async () => {
    const spy = mockFetch(200, { id: '0Afxx' })
    vi.stubGlobal('fetch', spy)

    await sf.deployMetadata(Buffer.from('zip'))
    const opts = spy.mock.calls[0][1] as RequestInit
    const contentType = (opts.headers as Record<string, string>)['Content-Type']
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/)
  })

  it('includes ZIP buffer in request body', async () => {
    const spy = mockFetch(200, { id: '0Afxx' })
    vi.stubGlobal('fetch', spy)

    const zip = Buffer.from('test-zip-data')
    await sf.deployMetadata(zip)
    const body = spy.mock.calls[0][1].body as Buffer
    expect(body.includes(zip)).toBe(true)
  })

  it('throws on failure', async () => {
    vi.stubGlobal('fetch', mockFetch(500, 'Server error', false))
    await expect(sf.deployMetadata(Buffer.from('zip'))).rejects.toThrow('Metadata deploy request failed (500)')
  })
})

// ─── waitForDeploy() ─────────────────────────────────────────────────────────

describe('waitForDeploy()', () => {
  it('returns result when deploy is done', async () => {
    const deployResult = {
      done: true,
      success: true,
      status: 'Succeeded',
      numberComponentsDeployed: 5,
      numberComponentsTotal: 5,
      numberComponentErrors: 0,
    }
    vi.stubGlobal('fetch', mockFetch(200, { deployResult }))

    const result = await sf.waitForDeploy('0Afxx')
    expect(result).toEqual(deployResult)
    expect(result.success).toBe(true)
  })

  it('polls until done', async () => {
    vi.useFakeTimers()

    const pending = { done: false, success: false, status: 'InProgress', numberComponentsDeployed: 0, numberComponentsTotal: 5, numberComponentErrors: 0 }
    const complete = { done: true, success: true, status: 'Succeeded', numberComponentsDeployed: 5, numberComponentsTotal: 5, numberComponentErrors: 0 }

    let callCount = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      callCount++
      const result = callCount >= 2 ? complete : pending
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ deployResult: result }),
      })
    }))

    const promise = sf.waitForDeploy('0Afxx', 30000)

    // Advance past the poll interval (3000ms)
    await vi.advanceTimersByTimeAsync(3500)

    const result = await promise
    expect(result.done).toBe(true)
    expect(callCount).toBeGreaterThanOrEqual(2)

    vi.useRealTimers()
  })

  it('throws on poll failure', async () => {
    vi.stubGlobal('fetch', mockFetch(500, 'Error', false))
    await expect(sf.waitForDeploy('0Afxx', 5000)).rejects.toThrow('Deploy status check failed (500)')
  })
})

// ─── DuplicateError ──────────────────────────────────────────────────────────

describe('DuplicateError', () => {
  it('is an instance of Error', () => {
    const err = new DuplicateError('test')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(DuplicateError)
  })

  it('has name DuplicateError', () => {
    const err = new DuplicateError('test')
    expect(err.name).toBe('DuplicateError')
  })

  it('preserves the message', () => {
    const err = new DuplicateError('Already exists')
    expect(err.message).toBe('Already exists')
  })
})
