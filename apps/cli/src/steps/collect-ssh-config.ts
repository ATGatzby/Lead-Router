import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { text, password, note, log, cancel, isCancel } from '@clack/prompts'
import type { SshConfig } from '../utils/ssh.js'

export interface SshCollectOptions {
  /** Override SSH port (default: 22) */
  sshPort?: number
  /** Override SSH username (default: root) */
  sshUser?: string
  /** Explicit path to SSH private key — skips auto-detection */
  sshKey?: string
  /** Override remote install directory (default: ~/lead-routing) */
  remoteDir?: string
}

// Standard key locations tried in order — first existing file wins
const DEFAULT_KEYS = [
  join(homedir(), '.ssh', 'id_ed25519'),
  join(homedir(), '.ssh', 'id_rsa'),
  join(homedir(), '.ssh', 'id_ecdsa'),
]

function detectDefaultKey(): string | undefined {
  return DEFAULT_KEYS.find(existsSync)
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
 * Auto-detects SSH key from standard locations — only prompts for what it can't determine.
 * No connection is made here — this is prompt-only so that dry-run can write
 * config without connecting.
 */
export async function collectSshConfig(opts: SshCollectOptions = {}): Promise<SshConfig> {
  note(
    'The CLI will SSH into your server to deploy the full stack.\n' +
      'You will need:\n' +
      '  • Server hostname or IP address\n' +
      '  • SSH access (key auto-detected, or password)\n' +
      '  • Docker 24+ already installed on the server',
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
  // Priority: --ssh-key flag → auto-detected default key → prompt for password.
  // Port, username, and remote dir use sensible defaults and never prompt.
  let privateKeyPath: string | undefined
  let pwd: string | undefined

  if (opts.sshKey) {
    // Explicit key from --ssh-key flag
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
    const detected = detectDefaultKey()
    if (detected) {
      // Found a standard key — use it silently
      privateKeyPath = detected
      log.info(`Using SSH key: ${detected.replace(homedir(), '~')}`)
    } else {
      // No key found — fall back to password auth (skip auth method select)
      log.warn('No SSH key found at ~/.ssh/id_ed25519, ~/.ssh/id_rsa, or ~/.ssh/id_ecdsa')
      const p = await password({
        message: `SSH password for ${opts.sshUser ?? 'root'}@${host as string}`,
        validate: (v) => (!v ? 'Required' : undefined),
      })
      if (isCancel(p)) bail(p)
      pwd = p as string
    }
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
