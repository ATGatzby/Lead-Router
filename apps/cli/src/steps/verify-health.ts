import { spinner, log } from '@clack/prompts'

interface HealthResult {
  service: string
  url: string
  ok: boolean
  detail: string
}

export async function verifyHealth(appUrl: string, engineUrl: string): Promise<void> {
  const checks: Array<{ service: string; url: string }> = [
    { service: 'Web app', url: `${appUrl}/api/health` },
    { service: 'Routing engine', url: `${engineUrl}/health` },
  ]

  const results = await Promise.all(checks.map(({ service, url }) => pollHealth(service, url)))

  for (const r of results) {
    if (r.ok) {
      log.success(`${r.service} — ${r.url}`)
    } else {
      log.warn(`${r.service} not responding yet — ${r.detail}`)
    }
  }
}

async function pollHealth(
  service: string,
  url: string,
  maxAttempts = 24,  // 24 × 5s = 2 min — allows time for Caddy TLS cert provisioning
  intervalMs = 5000
): Promise<HealthResult> {
  const s = spinner()
  s.start(`Waiting for ${service}`)

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
      if (res.ok) {
        s.stop(`${service} is up`)
        return { service, url, ok: true, detail: `HTTP ${res.status}` }
      }
      s.message(`${service} — HTTP ${res.status}, retrying (${i + 1}/${maxAttempts})`)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      s.message(`${service} — ${detail}, retrying (${i + 1}/${maxAttempts})`)
    }
    await sleep(intervalMs)
  }

  s.stop(`${service} — did not respond after ${maxAttempts} attempts`)
  return {
    service,
    url,
    ok: false,
    detail: `timed out after ${(maxAttempts * intervalMs) / 1000}s`,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
