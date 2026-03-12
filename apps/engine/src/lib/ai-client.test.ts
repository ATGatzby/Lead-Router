import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock @lead-routing/db
vi.mock('@lead-routing/db', () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(),
    },
  },
}))

// Mock ./crypto
vi.mock('./crypto', () => ({
  decryptField: vi.fn((val: string) => `decrypted-${val}`),
}))

import { prisma } from '@lead-routing/db'
import { decryptField } from './crypto'
import { resolveCompanySimilarity, isAIConfigured } from './ai-client'

const mockFindUnique = prisma.organization.findUnique as ReturnType<typeof vi.fn>
const mockDecrypt = decryptField as ReturnType<typeof vi.fn>

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockOrg(overrides: Record<string, unknown> = {}) {
  return {
    aiProvider: 'openai',
    aiApiKey: 'encrypted-key',
    aiModelName: 'gpt-4o',
    aiBaseUrl: null,
    aiCustomHeaders: null,
    ...overrides,
  }
}

function mockFetchSuccess(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('isAIConfigured', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear the module-level cache between tests by re-importing
    // Since we can't easily clear the cache Map, we test via different orgIds
  })

  it('returns true when org has AI configured', async () => {
    mockFindUnique.mockResolvedValue(mockOrg())
    const result = await isAIConfigured('org-has-ai')
    expect(result).toBe(true)
  })

  it('returns false when org has no AI provider', async () => {
    mockFindUnique.mockResolvedValue(mockOrg({ aiProvider: null }))
    const result = await isAIConfigured('org-no-provider')
    expect(result).toBe(false)
  })

  it('returns false when org has no API key', async () => {
    mockFindUnique.mockResolvedValue(mockOrg({ aiApiKey: null }))
    const result = await isAIConfigured('org-no-key')
    expect(result).toBe(false)
  })

  it('returns false when org does not exist', async () => {
    mockFindUnique.mockResolvedValue(null)
    const result = await isAIConfigured('org-missing')
    expect(result).toBe(false)
  })
})

describe('resolveCompanySimilarity', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns null when AI is not configured', async () => {
    mockFindUnique.mockResolvedValue(mockOrg({ aiProvider: null }))
    const result = await resolveCompanySimilarity('org-nocfg', 'Acme Inc', 'ACME Corp')
    expect(result).toBeNull()
  })

  it('calls OpenAI and parses similarity result', async () => {
    mockFindUnique.mockResolvedValue(mockOrg())
    global.fetch = mockFetchSuccess({
      choices: [{ message: { content: '{"isSimilar": true, "confidence": 0.95}' } }],
    })

    const result = await resolveCompanySimilarity('org-openai', 'Acme Inc', 'ACME Corporation')
    expect(result).toEqual({ isSimilar: true, confidence: 0.95 })
    expect(global.fetch).toHaveBeenCalledOnce()

    const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(JSON.parse(opts.body).max_tokens).toBe(50)
  })

  it('calls Claude API with correct headers', async () => {
    mockFindUnique.mockResolvedValue(mockOrg({ aiProvider: 'claude', aiModelName: 'claude-sonnet-4-5-20250514' }))
    global.fetch = mockFetchSuccess({
      content: [{ type: 'text', text: '{"isSimilar": false, "confidence": 0.1}' }],
    })

    const result = await resolveCompanySimilarity('org-claude', 'Google', 'Meta')
    expect(result).toEqual({ isSimilar: false, confidence: 0.1 })

    const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(opts.headers['anthropic-version']).toBe('2023-06-01')
    expect(opts.headers['x-api-key']).toBe('decrypted-encrypted-key')
  })

  it('calls Gemini API with key in URL', async () => {
    mockFindUnique.mockResolvedValue(mockOrg({ aiProvider: 'gemini', aiModelName: 'gemini-2.5-flash' }))
    global.fetch = mockFetchSuccess({
      candidates: [{ content: { parts: [{ text: '{"isSimilar": true, "confidence": 0.85}' }] } }],
    })

    const result = await resolveCompanySimilarity('org-gemini', 'Microsoft', 'MSFT')
    expect(result).toEqual({ isSimilar: true, confidence: 0.85 })

    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('generativelanguage.googleapis.com')
    expect(url).toContain('key=decrypted-encrypted-key')
  })

  it('uses custom baseUrl for custom provider', async () => {
    mockFindUnique.mockResolvedValue(
      mockOrg({
        aiProvider: 'custom',
        aiBaseUrl: 'https://my-proxy.example.com',
        aiCustomHeaders: { 'X-Custom': 'header-val' },
      }),
    )
    global.fetch = mockFetchSuccess({
      choices: [{ message: { content: '{"isSimilar": true, "confidence": 0.9}' } }],
    })

    const result = await resolveCompanySimilarity('org-custom', 'Acme', 'Acme Ltd')
    expect(result).toEqual({ isSimilar: true, confidence: 0.9 })

    const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://my-proxy.example.com/v1/chat/completions')
    expect(opts.headers['X-Custom']).toBe('header-val')
  })

  it('returns null on HTTP error', async () => {
    mockFindUnique.mockResolvedValue(mockOrg())
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429, statusText: 'Too Many Requests' })

    const result = await resolveCompanySimilarity('org-err', 'A', 'B')
    expect(result).toBeNull()
  })

  it('returns null on malformed JSON response', async () => {
    mockFindUnique.mockResolvedValue(mockOrg())
    global.fetch = mockFetchSuccess({
      choices: [{ message: { content: 'I think they are similar!' } }],
    })

    const result = await resolveCompanySimilarity('org-badjson', 'A', 'B')
    expect(result).toBeNull()
  })

  it('returns null on fetch exception', async () => {
    mockFindUnique.mockResolvedValue(mockOrg())
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await resolveCompanySimilarity('org-netfail', 'A', 'B')
    expect(result).toBeNull()
  })

  it('clamps confidence to 0-1 range', async () => {
    mockFindUnique.mockResolvedValue(mockOrg())
    global.fetch = mockFetchSuccess({
      choices: [{ message: { content: '{"isSimilar": true, "confidence": 1.5}' } }],
    })

    const result = await resolveCompanySimilarity('org-clamp', 'A', 'B')
    expect(result).toEqual({ isSimilar: true, confidence: 1.0 })
  })

  it('defaults confidence when missing from response', async () => {
    mockFindUnique.mockResolvedValue(mockOrg())
    global.fetch = mockFetchSuccess({
      choices: [{ message: { content: '{"isSimilar": true}' } }],
    })

    const result = await resolveCompanySimilarity('org-noconf', 'A', 'B')
    expect(result).toEqual({ isSimilar: true, confidence: 0.8 })
  })

  it('handles JSON wrapped in markdown code fences', async () => {
    mockFindUnique.mockResolvedValue(mockOrg())
    global.fetch = mockFetchSuccess({
      choices: [{ message: { content: '```json\n{"isSimilar": false, "confidence": 0.3}\n```' } }],
    })

    const result = await resolveCompanySimilarity('org-fenced', 'Apple', 'Orange')
    expect(result).toEqual({ isSimilar: false, confidence: 0.3 })
  })

  it('returns null when decryptField throws', async () => {
    mockFindUnique.mockResolvedValue(mockOrg())
    mockDecrypt.mockImplementationOnce(() => {
      throw new Error('decryption failed')
    })

    const result = await resolveCompanySimilarity('org-decrypt-fail', 'A', 'B')
    expect(result).toBeNull()
  })
})
