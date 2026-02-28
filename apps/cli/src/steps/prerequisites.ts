import net from 'node:net'
import { log } from '@clack/prompts'
import { runSilent } from '../utils/exec.js'

interface CheckResult {
  ok: boolean
  label: string
  detail?: string
}

export async function checkPrerequisites(): Promise<void> {
  const results: CheckResult[] = await Promise.all([
    checkDocker(),
    checkDockerCompose(),
    checkNodeVersion(),
    checkPort(80),
    checkPort(443),
    checkSalesforceCLI(),
  ])

  // Hard failures (blocking)
  const failed = results.filter((r) => !r.ok && r.detail !== 'warn')
  // Warnings (non-blocking)
  const warnings = results.filter((r) => !r.ok && r.detail === 'warn')

  for (const r of results) {
    if (r.ok) {
      log.success(r.label)
    } else if (r.detail === 'warn') {
      log.warn(r.label)
    } else {
      log.error(`${r.label}${r.detail ? ` — ${r.detail}` : ''}`)
    }
  }

  if (failed.length > 0) {
    throw new Error(
      `Missing prerequisites:\n${failed.map((r) => `  • ${r.label}`).join('\n')}\n\nPlease install them and re-run lead-routing init.`
    )
  }

  if (warnings.length > 0) {
    log.warn('Some optional prerequisites are missing (see above). Setup will continue.')
  }
}

async function checkDocker(): Promise<CheckResult> {
  const out = await runSilent('docker', ['--version'])
  if (!out) {
    return { ok: false, label: 'Docker', detail: 'not found — install Docker Desktop or Docker Engine' }
  }
  // Parse "Docker version 24.0.0, ..." and check major >= 24
  const match = out.match(/Docker version (\d+)/)
  if (match && parseInt(match[1], 10) < 24) {
    return { ok: false, label: `Docker ${out.trim()}`, detail: 'version 24+ required' }
  }
  return { ok: true, label: `Docker — ${out.trim()}` }
}

async function checkDockerCompose(): Promise<CheckResult> {
  const out = await runSilent('docker', ['compose', 'version'])
  if (!out) {
    return { ok: false, label: 'Docker Compose', detail: 'not found — update Docker to include Compose v2' }
  }
  return { ok: true, label: `Docker Compose — ${out.trim()}` }
}

async function checkNodeVersion(): Promise<CheckResult> {
  const version = process.version // e.g. "v22.0.0"
  const major = parseInt(version.slice(1), 10)
  if (major < 20) {
    return { ok: false, label: `Node.js ${version}`, detail: 'version 20+ required' }
  }
  return { ok: true, label: `Node.js ${version}` }
}

async function checkPort(port: number): Promise<CheckResult> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => {
      resolve({
        ok: false,
        label: `Port ${port} — already in use (Caddy needs this port for HTTPS)`,
        detail: `free up port ${port} before continuing`,
      })
    })
    server.once('listening', () => {
      server.close()
      resolve({ ok: true, label: `Port ${port} — available` })
    })
    server.listen(port, '0.0.0.0')
  })
}

async function checkSalesforceCLI(): Promise<CheckResult> {
  const out = await runSilent('sf', ['--version'])
  if (!out) {
    return {
      ok: false,
      label: 'Salesforce CLI (sf) — not found (needed for `lead-routing sfdc deploy`)\n' +
        '     Install: https://developer.salesforce.com/tools/salesforcecli',
      detail: 'warn',
    }
  }
  return { ok: true, label: `Salesforce CLI — ${out.trim()}` }
}
