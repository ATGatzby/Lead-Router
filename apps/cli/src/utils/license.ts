import chalk from 'chalk'

export const LICENSE_API_URL = process.env.LICENSE_API_URL || 'https://lead-routing-license.artyagi2011.workers.dev'

export interface LicenseInfo {
  valid: boolean
  tier: 'free' | 'pro'
  validUntil?: string
  error?: string
}

export async function validateLicense(key: string): Promise<LicenseInfo> {
  try {
    const res = await fetch(`${LICENSE_API_URL}/v1/licenses/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { valid: false, tier: 'free', error: body || `HTTP ${res.status}` }
    }

    return (await res.json()) as LicenseInfo
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('abort') || message.includes('timeout')) {
      return { valid: false, tier: 'free', error: 'License server timed out' }
    }
    return { valid: false, tier: 'free', error: 'License server unreachable' }
  }
}

export function formatTierBadge(tier: string): string {
  if (tier === 'pro') return chalk.bgGreen.black(' PRO ')
  return chalk.bgGray.white(' FREE ')
}
