import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { intro, outro, text, password, spinner, log } from '@clack/prompts'
import chalk from 'chalk'
import { execa } from 'execa'
import { findInstallDir } from '../utils/config.js'

/** Read all key=value pairs from an env file into a Map */
function parseEnv(filePath: string): Map<string, string> {
  const map = new Map<string, string>()
  if (!existsSync(filePath)) return map
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    map.set(trimmed.slice(0, eq), trimmed.slice(eq + 1))
  }
  return map
}

/** Write a Map of key=value pairs back, preserving comments/blank lines */
function writeEnv(filePath: string, updates: Record<string, string>): void {
  const lines = existsSync(filePath) ? readFileSync(filePath, 'utf8').split('\n') : []
  const updated = new Set<string>()
  const result = lines.map((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return line
    const eq = trimmed.indexOf('=')
    if (eq === -1) return line
    const key = trimmed.slice(0, eq)
    if (key in updates) {
      updated.add(key)
      return `${key}=${updates[key]}`
    }
    return line
  })
  // Append any keys that weren't already in the file
  for (const [key, val] of Object.entries(updates)) {
    if (!updated.has(key)) result.push(`${key}=${val}`)
  }
  writeFileSync(filePath, result.join('\n'), 'utf8')
}

export async function runConfigSfdc(): Promise<void> {
  intro('Lead Routing — Update Salesforce Credentials')

  const dir = findInstallDir()
  if (!dir) {
    log.error('No lead-routing installation found in the current directory.')
    log.info('Run `lead-routing init` first, or cd into your installation directory.')
    process.exit(1)
  }

  const envWeb = join(dir, '.env.web')
  const envEngine = join(dir, '.env.engine')

  // Show current values as defaults
  const currentWeb = parseEnv(envWeb)
  const currentClientId = currentWeb.get('SFDC_CLIENT_ID') ?? ''
  const currentLoginUrl = currentWeb.get('SFDC_LOGIN_URL') ?? 'https://login.salesforce.com'
  const currentAppUrl = currentWeb.get('APP_URL') ?? ''
  const callbackUrl = `${currentAppUrl}/api/auth/callback`

  log.info(
    'Paste the credentials from your Salesforce Connected App.\n' +
    `Callback URL for your Connected App: ${callbackUrl}`
  )

  const clientId = await text({
    message: 'Consumer Key (Client ID)',
    initialValue: currentClientId,
    validate: (v) => (!v ? 'Required' : undefined),
  })
  if (clientId === null || (typeof clientId === 'symbol')) { process.exit(0) }

  const clientSecret = await password({
    message: 'Consumer Secret (Client Secret)',
    validate: (v) => (!v ? 'Required' : undefined),
  })
  if (clientSecret === null || (typeof clientSecret === 'symbol')) { process.exit(0) }

  const updates = {
    SFDC_CLIENT_ID: clientId as string,
    SFDC_CLIENT_SECRET: clientSecret as string,
  }

  writeEnv(envWeb, updates)
  writeEnv(envEngine, updates)
  log.success('Updated .env.web and .env.engine')

  // Restart web + engine to pick up new credentials
  const s = spinner()
  s.start('Restarting web and engine containers…')
  try {
    await execa('docker', ['compose', 'up', '-d', '--force-recreate', 'web', 'engine'], {
      cwd: dir,
    })
    s.stop('Containers restarted')
  } catch (err) {
    s.stop('Restart failed — run `docker compose up -d --force-recreate web engine` manually')
    log.warn(String(err))
  }

  outro(
    'Salesforce credentials updated!\n\n' +
    'Next: go to the web app → Settings → Connect Salesforce to refresh your OAuth tokens.'
  )
}

export function runConfigShow(): void {
  const dir = findInstallDir()
  if (!dir) {
    console.error('No lead-routing installation found in the current directory.')
    process.exit(1)
  }

  const envWeb = join(dir, '.env.web')
  const cfg = parseEnv(envWeb)

  const adminSecret = cfg.get('ADMIN_SECRET') ?? '(not found)'
  const appUrl = cfg.get('APP_URL') ?? '(not found)'
  const sfdcClientId = cfg.get('SFDC_CLIENT_ID') ?? '(not found)'

  console.log()
  console.log(chalk.bold('Lead Routing — Installation Config'))
  console.log()
  console.log(`  Admin panel:   ${chalk.cyan(appUrl + '/admin')}`)
  console.log(`  Admin secret:  ${chalk.yellow(adminSecret)}`)
  console.log()
  console.log(`  SFDC Client ID: ${chalk.white(sfdcClientId)}`)
  console.log()
}
