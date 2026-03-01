import { log } from '@clack/prompts'
import { runSilent } from '../utils/exec.js'

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
 */
export async function checkPrerequisites(): Promise<void> {
  const results: CheckResult[] = await Promise.all([
    checkNodeVersion(),
    checkSalesforceCLI(),
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

async function checkSalesforceCLI(): Promise<CheckResult> {
  const out = await runSilent('sf', ['--version'])
  if (!out) {
    return {
      ok: false,
      label: 'Salesforce CLI (sf) — not found',
      detail: 'install from https://developer.salesforce.com/tools/salesforcecli',
    }
  }
  return { ok: true, label: `Salesforce CLI — ${out.trim()}` }
}
