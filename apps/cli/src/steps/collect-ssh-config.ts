import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { text, password, note, log, cancel, isCancel } from '@clack/prompts'
import type { SshConfig } from '../utils/ssh.js'

export interface SshCollectOptions {
  /** Override SSH port (default: 22) */
  sshPort?: number
  /** Override SSH username (default: root) */
  sshUser?: string
  /** Explicit path to SSH private key — bypasses password prompt */
  sshKey?: string
  /** Override remote install directory (default: ~/lead-routing) */
  remoteDir?: string
}

function bail(value: unknown): never {
  if (isCancel(value)) {
    cancel('Setup cancelled.')
    process.exit(0)
  }
  throw new Error('Unexpected cancel')
}

/**
 * Prompt the customer for their VPS SSH connection details.
 * Always prompts for a password — no key auto-detection.
 * Power users can pass --ssh-key to use a key instead.
 */
export async function collectSshConfig(opts: SshCollectOptions = {}): Promise<SshConfig> {
  note(
    'The CLI will SSH into your server to deploy the full stack.\n' +
      'You will need:\n' +
      '  • Server hostname or IP address\n' +
      '  • SSH password for your server (root access)\n' +
      '  • A fresh Linux VPS (Ubuntu/Debian/CentOS) — Docker installed automatically',
    'Server connection'
  )

  // ── Host ───────────────────────────────────────────────────────────────────
  const host = await text({
    message: 'Server hostname or IP address',
    placeholder: '165.22.100.50  or  vps.acme.com',
    validate: (v) => (!v ? 'Required' : undefined),
  })
  if (isCancel(host)) bail(host)

  // ── Auth ───────────────────────────────────────────────────────────────────
  // --ssh-key flag: use a key instead of password (power-user override)
  // Default: always prompt for password — simpler and more reliable for fresh VPS setups
  let privateKeyPath: string | undefined
  let pwd: string | undefined

  if (opts.sshKey) {
    const resolved = opts.sshKey.startsWith('~')
      ? homedir() + opts.sshKey.slice(1)
      : opts.sshKey
    if (!existsSync(resolved)) {
      log.error(`SSH key not found: ${resolved}`)
      process.exit(1)
    }
    privateKeyPath = resolved
    log.info(`Using SSH key: ${opts.sshKey}`)
  } else {
    const p = await password({
      message: `SSH password for ${opts.sshUser ?? 'root'}@${host as string}`,
      validate: (v) => (!v ? 'Required' : undefined),
    })
    if (isCancel(p)) bail(p)
    pwd = p as string
  }

  return {
    host: host as string,
    port: opts.sshPort ?? 22,
    username: opts.sshUser ?? 'root',
    privateKeyPath,
    password: pwd,
    remoteDir: opts.remoteDir ?? '~/lead-routing',
  }
}
