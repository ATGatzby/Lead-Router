import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { text, password, select, note, cancel, isCancel } from '@clack/prompts'
import type { SshConfig } from '../utils/ssh.js'

function bail(value: unknown): never {
  if (isCancel(value)) {
    cancel('Setup cancelled.')
    process.exit(0)
  }
  throw new Error('Unexpected cancel')
}

/**
 * Prompt the customer for their VPS SSH connection details.
 * No connection is made here — this is prompt-only so that dry-run
 * can write config without connecting.
 */
export async function collectSshConfig(): Promise<SshConfig> {
  note(
    'The CLI will SSH into your server to deploy the full stack.\n' +
      'You will need:\n' +
      '  • Server hostname or IP address\n' +
      '  • SSH access (key file recommended, password supported)\n' +
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

  // ── Port ───────────────────────────────────────────────────────────────────
  const portRaw = await text({
    message: 'SSH port',
    placeholder: '22',
    initialValue: '22',
    validate: (v) => {
      const n = parseInt(v, 10)
      if (isNaN(n) || n < 1 || n > 65535) return 'Must be a valid port (1–65535)'
    },
  })
  if (isCancel(portRaw)) bail(portRaw)

  // ── Username ───────────────────────────────────────────────────────────────
  const username = await text({
    message: 'SSH username',
    placeholder: 'root',
    initialValue: 'root',
    validate: (v) => (!v ? 'Required' : undefined),
  })
  if (isCancel(username)) bail(username)

  // ── Auth method ───────────────────────────────────────────────────────────
  const authMethod = await select({
    message: 'SSH authentication method',
    options: [
      { value: 'key', label: 'SSH key file (recommended)' },
      { value: 'password', label: 'Password' },
    ],
  })
  if (isCancel(authMethod)) bail(authMethod)

  let privateKeyPath: string | undefined
  let pwd: string | undefined

  if (authMethod === 'key') {
    const defaultKey = `${homedir()}/.ssh/id_rsa`
    const keyPath = await text({
      message: 'Path to SSH private key',
      placeholder: defaultKey,
      initialValue: `~/.ssh/id_rsa`,
      validate: (v) => {
        const resolved = v.startsWith('~') ? homedir() + v.slice(1) : v
        if (!existsSync(resolved)) return `Key file not found: ${resolved}`
      },
    })
    if (isCancel(keyPath)) bail(keyPath)
    const raw = keyPath as string
    privateKeyPath = raw.startsWith('~') ? homedir() + raw.slice(1) : raw
  } else {
    const p = await password({
      message: 'SSH password',
      validate: (v) => (!v ? 'Required' : undefined),
    })
    if (isCancel(p)) bail(p)
    pwd = p as string
  }

  // ── Remote install directory ───────────────────────────────────────────────
  const remoteDir = await text({
    message: 'Remote install directory on server',
    placeholder: '~/lead-routing',
    initialValue: '~/lead-routing',
    validate: (v) => (!v ? 'Required' : undefined),
  })
  if (isCancel(remoteDir)) bail(remoteDir)

  return {
    host: host as string,
    port: parseInt(portRaw as string, 10),
    username: username as string,
    privateKeyPath,
    password: pwd,
    remoteDir: remoteDir as string,
  }
}
