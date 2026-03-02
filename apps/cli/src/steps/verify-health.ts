import { spinner, log } from '@clack/prompts'
import type { SshConnection } from '../utils/ssh.js'

interface HealthResult {
  service: string
  url: string
  ok: boolean
  detail: string
}

/**
 * Poll the public HTTPS health endpoints for the web app and routing engine.
 *
 * On timeout, SSHes into the server to fetch docker compose ps + Caddy logs
 * so the user can immediately see why services are unreachable (port conflict,
 * TLS rate limit, container crash, etc.) without needing to SSH in manually.
 *
 * Throws if any service fails — SFDC deploy depends on the app being up.
 */
export async function verifyHealth(
  appUrl: string,
  engineUrl: string,
  ssh: SshConnection,
  remoteDir: string
): Promise<void> {
  const checks: Array<{ service: string; url: string }> = [
    { service: 'Web app', url: `${appUrl}/api/health` },
    { service: 'Routing engine', url: `${engineUrl}/health` },
  ]

  const results = await Promise.all(checks.map(({ service, url }) => pollHealth(service, url)))

  for (const r of results) {
    if (r.ok) {
      log.success(`${r.service} — ${r.url}`)
    } else {
      log.warn(`${r.service} — did not respond after ${r.detail}`)
    }
  }

  const failed = results.filter((r) => !r.ok)
  if (failed.length === 0) return

  // ── SSH diagnostics ────────────────────────────────────────────────────────
  // Show container status and Caddy logs directly in the terminal so the user
  // can see the root cause without having to SSH in manually.
  log.info('Fetching remote diagnostics…')

  try {
    const { stdout: ps } = await ssh.execSilent('docker compose ps --format table', remoteDir)
    if (ps.trim()) log.info(`Container status:\n${ps.trim()}`)
  } catch { /* non-fatal */ }

  try {
    const { stdout: caddyLogs } = await ssh.execSilent(
      'docker compose logs caddy --tail 30 --no-color 2>&1',
      remoteDir
    )
    if (caddyLogs.trim()) log.info(`Caddy logs (last 30 lines):\n${caddyLogs.trim()}`)
  } catch { /* non-fatal */ }

  const failedNames = failed.map((r) => r.service).join(' and ')
  throw new Error(
    `${failedNames} did not respond after 2 minutes.\n\n` +
    `Common causes (check Caddy logs above):\n` +
    `  • Let's Encrypt rate limit — wait until tomorrow and re-run\n` +
    `  • Port 80/443 still blocked by another process\n` +
    `  • Container crashed — check container status above\n\n` +
    `To resume once fixed:\n` +
    `  1. SSH into your server:\n` +
    `       cd ${remoteDir} && docker compose restart caddy\n` +
    `  2. Then re-run Salesforce setup:\n` +
    `       lead-routing sfdc deploy`
  )
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
    detail: `${(maxAttempts * intervalMs) / 1000}s`,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
