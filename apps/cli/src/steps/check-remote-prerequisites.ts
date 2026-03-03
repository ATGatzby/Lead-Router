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
 *
 * Port 80/443 checks attempt to auto-stop common system web servers
 * (nginx, apache2, caddy, etc.) that would prevent Caddy from binding.
 * If a port cannot be freed, it is treated as a hard error — Caddy
 * cannot provision TLS certs without those ports.
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

/**
 * Check if a port is free. If occupied, attempt to stop known system web servers
 * (nginx, apache2, httpd, lighttpd, caddy) that conflict with Caddy.
 *
 * Returns ok:true if the port is free or was freed automatically.
 * Returns a hard error (ok:false, no warn) if the port cannot be freed —
 * Caddy requires ports 80 and 443 to obtain TLS certificates; without them
 * the web app and engine will never be reachable over HTTPS.
 */
async function checkRemotePort(ssh: SshConnection, port: number): Promise<CheckResult> {
  const portCheckCmd =
    `ss -tlnp 2>/dev/null | grep ':${port} ' || ` +
    `netstat -tlnp 2>/dev/null | grep ':${port} ' || echo "free"`

  const { stdout: initial } = await ssh.execSilent(portCheckCmd)
  const isBound = initial.trim() !== 'free' && initial.trim() !== ''

  if (!isBound) {
    return { ok: true, label: `Port ${port} — available` }
  }

  // Attempt to auto-stop common system web servers that conflict with Caddy
  const knownServices = ['nginx', 'apache2', 'httpd', 'lighttpd', 'caddy']
  for (const svc of knownServices) {
    const { code: activeCode } = await ssh.execSilent(
      `systemctl is-active --quiet ${svc} 2>/dev/null`
    )
    if (activeCode === 0) {
      // Service is running — stop and disable it so it won't restart on reboot
      await ssh.execSilent(
        `systemctl stop ${svc} 2>/dev/null; systemctl disable ${svc} 2>/dev/null`
      )
      const { stdout: recheck } = await ssh.execSilent(portCheckCmd)
      if (recheck.trim() === 'free' || !recheck.trim()) {
        return {
          ok: true,
          label: `Port ${port} — freed (stopped and disabled system ${svc} service)`,
        }
      }
    }
  }

  // Port still occupied — show what's holding it
  const { stdout: occupant } = await ssh.execSilent(
    `ss -tlnp 2>/dev/null | grep ':${port} ' | head -1 || echo "unknown process"`
  )
  const occupantStr = occupant.trim()

  // docker-proxy = a Docker container already owns the port.
  // Docker Compose will stop the old container and reclaim the port when it
  // starts our stack — this is safe to continue past as a warning.
  if (occupantStr.includes('docker-proxy')) {
    return {
      ok: false,
      warn: true,
      label:
        `Port ${port} is held by an existing Docker container (docker-proxy).\n` +
        `  Docker Compose will reclaim it when the new stack starts — continuing.`,
    }
  }

  return {
    ok: false,
    // Hard error — non-Docker process; Caddy cannot get TLS certs without these ports
    label:
      `Port ${port} is occupied and could not be freed automatically.\n` +
      `  Occupant: ${occupantStr}\n` +
      `  Stop the conflicting process on the server, then re-run:\n` +
      `    lead-routing init`,
  }
}
