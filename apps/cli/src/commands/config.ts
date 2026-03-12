import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { intro, outro, log } from '@clack/prompts'
import chalk from 'chalk'
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
  intro('Lead Routing — Salesforce Configuration')

  const dir = findInstallDir()
  if (!dir) {
    log.error('No lead-routing installation found in the current directory.')
    log.info('Run `lead-routing init` first, or cd into your installation directory.')
    process.exit(1)
  }

  log.info(
    'Salesforce credentials are now managed automatically via the managed package.\n' +
    'No manual configuration is needed.\n\n' +
    'If you need to reconnect Salesforce, go to the web app → Settings → Connect Salesforce.'
  )

  outro('No changes needed.')
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

  console.log()
  console.log(chalk.bold('Lead Routing — Installation Config'))
  console.log()
  console.log(`  Admin panel:   ${chalk.cyan(appUrl + '/admin')}`)
  console.log(`  Admin secret:  ${chalk.yellow(adminSecret)}`)
  console.log()
}
