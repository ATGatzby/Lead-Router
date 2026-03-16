import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { LICENSE_API_URL } from './license.js'

export interface StoredCredentials {
  token: string
  customer: {
    id: string
    email: string
    firstName: string
    lastName: string
    tier: 'free' | 'pro'
    emailVerified: boolean
  }
  storedAt: string
}

const CRED_DIR = join(homedir(), '.lead-routing')
const CRED_FILE = join(CRED_DIR, 'credentials.json')

export function loadCredentials(): StoredCredentials | null {
  try {
    const data = readFileSync(CRED_FILE, 'utf-8')
    return JSON.parse(data) as StoredCredentials
  } catch {
    return null
  }
}

export function saveCredentials(creds: StoredCredentials): void {
  mkdirSync(CRED_DIR, { recursive: true })
  writeFileSync(CRED_FILE, JSON.stringify(creds, null, 2))
}

export function clearCredentials(): void {
  try { writeFileSync(CRED_FILE, '') } catch {}
}

export async function requireAuth(): Promise<StoredCredentials> {
  const creds = loadCredentials()
  if (!creds?.token) {
    throw new Error('Not logged in. Run `lead-routing login` first.')
  }

  // Verify token is still valid by calling /me
  const res = await fetch(`${LICENSE_API_URL}/v1/auth/me`, {
    headers: { 'Authorization': `Bearer ${creds.token}` },
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    clearCredentials()
    throw new Error('Session expired. Run `lead-routing login` to sign in again.')
  }

  const data = await res.json() as { customer: StoredCredentials['customer']; license?: { key: string; validUntil: string } }

  if (!data.customer.emailVerified) {
    throw new Error('Email not verified. Check your inbox for the verification link.')
  }

  // Update stored credentials with fresh data
  const updated: StoredCredentials = {
    token: creds.token,
    customer: data.customer,
    storedAt: creds.storedAt,
  }
  saveCredentials(updated)

  return updated
}

export async function apiLogin(email: string, password: string): Promise<{ token: string; customer: StoredCredentials['customer'] }> {
  const res = await fetch(`${LICENSE_API_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error: string }
    throw new Error(body.error || 'Login failed')
  }

  return await res.json() as { token: string; customer: StoredCredentials['customer'] }
}

export async function apiSignup(data: { firstName: string; lastName: string; email: string; password: string }): Promise<string> {
  const res = await fetch(`${LICENSE_API_URL}/v1/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error: string }
    throw new Error(body.error || 'Signup failed')
  }

  const result = await res.json() as { message: string }
  return result.message
}

export async function apiResendVerification(token: string): Promise<void> {
  const res = await fetch(`${LICENSE_API_URL}/v1/auth/resend-verification`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Failed' })) as { error: string }
    throw new Error(body.error || 'Failed to resend')
  }
}
