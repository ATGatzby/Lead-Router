import { log } from '@clack/prompts'
import type { SshConnection } from '../utils/ssh.js'

interface CheckResult {
  ok: boolean
  label: string
  warn?: boolean
}

/**
 * Verify that the remote server has the required software installed.
 * Runs after SSH connection is established.
 */
export async function checkRemotePrerequisites(ssh: SshConnection): Promise<void> {
  const results = await Promise.all([
    checkRemoteDocker(ssh),
    checkRemoteDockerCompose(ssh),
    checkRemotePort(ssh, 80),
    checkRemotePort(ssh, 443),
  ])

  const failed = results.filter((r) => !r.ok && !r.warn)
  const warnings = results.filter((r) => !r.ok && r.warn)

  for (const r of results) {
    if (r.ok) {
      log.success(r.label)
    } else if (r.warn) {
      log.warn(r.label)
    } else {
      log.error(r.label)
    }
  }

  if (warnings.length > 0) {
    log.warn('Non-blocking warnings above — setup will continue.')
  }

  if (failed.length > 0) {
    throw new Error(
      `Remote server is missing required software:\n` +
        failed.map((r) => `  • ${r.label}`).join('\n') +
        `\n\nInstall the missing software on your server and re-run lead-routing init.`
    )
  }
}

async function checkRemoteDocker(ssh: SshConnection): Promise<CheckResult> {
  const { stdout, code } = await ssh.execSilent('docker --version')
  if (code !== 0 || !stdout) {
    return {
      ok: false,
      label: 'Docker — not found on server (install Docker Engine 24+)',
    }
  }
  const match = stdout.match(/Docker version (\d+)/)
  if (match && parseInt(match[1], 10) < 24) {
    return { ok: false, label: `Docker ${stdout.trim()} — version 24+ required` }
  }
  return { ok: true, label: `Docker — ${stdout.trim()}` }
}

async function checkRemoteDockerCompose(ssh: SshConnection): Promise<CheckResult> {
  const { stdout, code } = await ssh.execSilent('docker compose version')
  if (code !== 0 || !stdout) {
    return {
      ok: false,
      label: 'Docker Compose — not found on server (update Docker to include Compose v2)',
    }
  }
  return { ok: true, label: `Docker Compose — ${stdout.trim()}` }
}

async function checkRemotePort(ssh: SshConnection, port: number): Promise<CheckResult> {
  // ss -tlnp is available on most modern Linux distros
  const { stdout } = await ssh.execSilent(
    `ss -tlnp 2>/dev/null | grep ':${port} ' || netstat -tlnp 2>/dev/null | grep ':${port} ' || echo "free"`
  )
  const isBound = stdout.trim() !== 'free' && stdout.trim() !== ''
  if (isBound) {
    return {
      ok: false,
      warn: true,
      label: `Port ${port} — already in use on server (Caddy needs it for HTTPS — ensure nothing else is binding it)`,
    }
  }
  return { ok: true, label: `Port ${port} — available` }
}
