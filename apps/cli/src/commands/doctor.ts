import { intro, outro, log } from '@clack/prompts'
import chalk from 'chalk'
import { execa } from 'execa'
import { findInstallDir, readConfig } from '../utils/config.js'

interface Check {
  label: string
  pass: boolean
  detail?: string
}

export async function runDoctor(): Promise<void> {
  console.log()
  intro(chalk.bold.cyan('Lead Routing — Health Check'))

  const dir = findInstallDir()
  if (!dir) {
    log.error('No lead-routing.json found. Run `lead-routing init` first.')
    process.exit(1)
  }

  const cfg = readConfig(dir)!
  const checks: Check[] = []

  // 1. Docker daemon
  checks.push(await checkDockerDaemon())

  // 2. Container states
  const containers = ['web', 'engine']
  if (cfg.dockerManaged.db) containers.push('postgres')
  if (cfg.dockerManaged.redis) containers.push('redis')

  for (const name of containers) {
    checks.push(await checkContainer(name, dir))
  }

  // 3. HTTP health endpoints
  checks.push(await checkEndpoint('Web app', `${cfg.appUrl}/api/health`))
  checks.push(await checkEndpoint('Routing engine', `${cfg.engineUrl}/health`))

  // Print results
  console.log()
  for (const c of checks) {
    const icon = c.pass ? chalk.green('✔') : chalk.red('✗')
    const label = c.pass ? chalk.white(c.label) : chalk.red(c.label)
    const detail = c.detail ? chalk.dim(` — ${c.detail}`) : ''
    console.log(`  ${icon}  ${label}${detail}`)
  }
  console.log()

  const failed = checks.filter((c) => !c.pass)
  if (failed.length === 0) {
    outro(chalk.green('All checks passed'))
  } else {
    outro(chalk.yellow(`${failed.length} check(s) failed`))
    process.exit(1)
  }
}

async function checkDockerDaemon(): Promise<Check> {
  try {
    await execa('docker', ['info'], { reject: true })
    return { label: 'Docker daemon', pass: true }
  } catch {
    return { label: 'Docker daemon', pass: false, detail: 'not running' }
  }
}

async function checkContainer(name: string, dir: string): Promise<Check> {
  try {
    const result = await execa(
      'docker',
      ['compose', 'ps', '--format', 'json', name],
      { cwd: dir, reject: false }
    )
    const output = (result.stdout as string).trim()
    if (!output) {
      return { label: `Container: ${name}`, pass: false, detail: 'not found' }
    }
    // docker compose ps --format json returns one JSON object per line
    const rows = output
      .split('\n')
      .map((l) => {
        try {
          return JSON.parse(l)
        } catch {
          return null
        }
      })
      .filter(Boolean)

    const running = rows.some(
      (r: { State?: string; Status?: string }) =>
        r.State === 'running' || (r.Status && r.Status.toLowerCase().includes('up'))
    )
    return {
      label: `Container: ${name}`,
      pass: running,
      detail: running ? 'running' : 'not running',
    }
  } catch {
    return { label: `Container: ${name}`, pass: false, detail: 'error checking status' }
  }
}

async function checkEndpoint(label: string, url: string): Promise<Check> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    return {
      label: `Health: ${label}`,
      pass: res.ok,
      detail: `HTTP ${res.status}`,
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return { label: `Health: ${label}`, pass: false, detail }
  }
}
