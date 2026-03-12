import { prisma } from '@lead-routing/db'
import { decryptField } from './crypto'

// ─── Types ───────────────────────────────────────────────────────────────────

interface OrgAIConfig {
  provider: string
  apiKey: string
  modelName: string
  baseUrl?: string
  customHeaders?: Record<string, string>
}

export interface SimilarityResult {
  isSimilar: boolean
  confidence: number
}

// ─── Config cache (5-minute TTL) ─────────────────────────────────────────────

const orgConfigCache = new Map<string, { config: OrgAIConfig | null; expiry: number }>()

const CONFIG_TTL_MS = 5 * 60 * 1000 // 5 minutes

async function getOrgAIConfig(orgId: string): Promise<OrgAIConfig | null> {
  const now = Date.now()
  const cached = orgConfigCache.get(orgId)
  if (cached && cached.expiry > now) {
    return cached.config
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      aiProvider: true,
      aiApiKey: true,
      aiModelName: true,
      aiBaseUrl: true,
      aiCustomHeaders: true,
    },
  })

  if (!org || !org.aiProvider || !org.aiApiKey) {
    orgConfigCache.set(orgId, { config: null, expiry: now + CONFIG_TTL_MS })
    return null
  }

  let apiKey: string
  try {
    apiKey = decryptField(org.aiApiKey)
  } catch {
    console.error(`[ai-client] Failed to decrypt AI API key for org ${orgId}`)
    orgConfigCache.set(orgId, { config: null, expiry: now + CONFIG_TTL_MS })
    return null
  }

  const config: OrgAIConfig = {
    provider: org.aiProvider,
    apiKey,
    modelName: org.aiModelName ?? getDefaultModel(org.aiProvider),
    baseUrl: org.aiBaseUrl ?? undefined,
    customHeaders: (org.aiCustomHeaders as Record<string, string>) ?? undefined,
  }

  orgConfigCache.set(orgId, { config, expiry: now + CONFIG_TTL_MS })
  return config
}

function getDefaultModel(provider: string): string {
  switch (provider) {
    case 'claude':
      return 'claude-sonnet-4-5-20250514'
    case 'openai':
      return 'gpt-4o'
    case 'gemini':
      return 'gemini-2.5-flash'
    default:
      return 'gpt-4o'
  }
}

// ─── Rate limiter (10 calls/sec per org) ─────────────────────────────────────

const rateLimiter = new Map<string, { count: number; windowStart: number }>()

const RATE_LIMIT_WINDOW_MS = 1000 // 1 second
const RATE_LIMIT_MAX = 10 // 10 calls per second

function checkRateLimit(orgId: string): boolean {
  const now = Date.now()
  const entry = rateLimiter.get(orgId)

  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimiter.set(orgId, { count: 1, windowStart: now })
    return true
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false
  }

  entry.count++
  return true
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

function buildPrompt(companyA: string, companyB: string): string {
  return (
    `Are these two company names referring to the same company? \n` +
    `Company A: "${companyA}"\n` +
    `Company B: "${companyB}"\n` +
    `Respond with ONLY a JSON object: {"isSimilar": true/false, "confidence": 0.0-1.0}`
  )
}

// ─── Provider-specific request helpers ───────────────────────────────────────

async function callClaude(
  config: OrgAIConfig,
  prompt: string,
): Promise<SimilarityResult | null> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.modelName,
      max_tokens: 50,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    console.error(`[ai-client] Claude API error: ${res.status} ${res.statusText}`)
    return null
  }

  const data = await res.json()
  const text = data.content?.[0]?.text
  return parseResponse(text)
}

async function callOpenAI(
  config: OrgAIConfig,
  prompt: string,
  baseUrl?: string,
  customHeaders?: Record<string, string>,
): Promise<SimilarityResult | null> {
  const url = `${baseUrl ?? 'https://api.openai.com'}/v1/chat/completions`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
    ...customHeaders,
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.modelName,
      max_tokens: 50,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    console.error(`[ai-client] OpenAI API error: ${res.status} ${res.statusText}`)
    return null
  }

  const data = await res.json()
  const text = data.choices?.[0]?.message?.content
  return parseResponse(text)
}

async function callGemini(
  config: OrgAIConfig,
  prompt: string,
): Promise<SimilarityResult | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.modelName}:generateContent?key=${config.apiKey}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 50 },
    }),
  })

  if (!res.ok) {
    console.error(`[ai-client] Gemini API error: ${res.status} ${res.statusText}`)
    return null
  }

  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  return parseResponse(text)
}

// ─── Response parser ─────────────────────────────────────────────────────────

function parseResponse(text: string | undefined | null): SimilarityResult | null {
  if (!text) return null

  try {
    // Extract JSON from response (handle markdown fences or extra text)
    const jsonMatch = text.match(/\{[\s\S]*?\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])

    if (typeof parsed.isSimilar !== 'boolean') return null

    const confidence =
      typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : parsed.isSimilar
          ? 0.8
          : 0.2

    return { isSimilar: parsed.isSimilar, confidence }
  } catch {
    return null
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Use the org's configured AI provider to determine if two company names
 * refer to the same company. Returns null if AI is not configured, rate
 * limited, or on any error (graceful fallback — never breaks routing).
 */
export async function resolveCompanySimilarity(
  orgId: string,
  companyA: string,
  companyB: string,
): Promise<SimilarityResult | null> {
  try {
    // 1. Load org AI config (cached)
    const config = await getOrgAIConfig(orgId)
    if (!config) return null

    // 2. Rate limit check
    if (!checkRateLimit(orgId)) {
      console.warn(`[ai-client] Rate limit exceeded for org ${orgId}`)
      return null
    }

    // 3. Build prompt
    const prompt = buildPrompt(companyA, companyB)

    // 4. Route to provider
    switch (config.provider) {
      case 'claude':
        return await callClaude(config, prompt)
      case 'gemini':
        return await callGemini(config, prompt)
      case 'openai':
        return await callOpenAI(config, prompt)
      case 'custom':
        return await callOpenAI(config, prompt, config.baseUrl, config.customHeaders)
      default:
        console.warn(`[ai-client] Unknown AI provider: ${config.provider}`)
        return null
    }
  } catch (err) {
    console.error(`[ai-client] Unexpected error for org ${orgId}:`, err)
    return null
  }
}

/**
 * Check if an org has AI configured (provider + encrypted key present).
 */
export async function isAIConfigured(orgId: string): Promise<boolean> {
  const config = await getOrgAIConfig(orgId)
  return config !== null
}
