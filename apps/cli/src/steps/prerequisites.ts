import { log } from '@clack/prompts'

interface CheckResult {
  ok: boolean
  label: string
  detail?: string
}

/**
 * Check prerequisites on the LOCAL machine only.
 *
 * Docker, Docker Compose, and port availability are now checked on the
 * remote server in check-remote-prerequisites.ts (after SSH connect).
 *
 * Salesforce CLI (`sf`) is no longer required — the CLI uses the
 * Salesforce REST API directly via built-in fetch().
 */
export async function checkPrerequisites(): Promise<void> {
  const results: CheckResult[] = await Promise.all([
    checkNodeVersion(),
  ])

  const failed = results.filter((r) => !r.ok)

  for (const r of results) {
    if (r.ok) {
      log.success(r.label)
    } else {
      log.error(`${r.label}${r.detail ? ` — ${r.detail}` : ''}`)
    }
  }

  if (failed.length > 0) {
    throw new Error(
      `Missing local prerequisites:\n${failed.map((r) => `  • ${r.label}`).join('\n')}\n\nPlease install them and re-run lead-routing init.`
    )
  }
}

async function checkNodeVersion(): Promise<CheckResult> {
  const version = process.version // e.g. "v22.0.0"
  const major = parseInt(version.slice(1), 10)
  if (major < 20) {
    return { ok: false, label: `Node.js ${version}`, detail: 'version 20+ required' }
  }
  return { ok: true, label: `Node.js ${version}` }
}
