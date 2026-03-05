import { rmSync, existsSync } from 'node:fs'
import { intro, outro, log, confirm, password as promptPassword, isCancel } from '@clack/prompts'
import chalk from 'chalk'
import { findInstallDir, readConfig } from '../utils/config.js'
import { SshConnection } from '../utils/ssh.js'

export async function runUninstall(): Promise<void> {
  console.log()
  intro(chalk.bold.red('Lead Routing — Uninstall'))

  const dir = findInstallDir()
  if (!dir) {
    log.error(
      'No lead-routing.json found. Run this command from your install directory.'
    )
    process.exit(1)
  }

  const cfg = readConfig(dir)!

  if (!cfg.ssh) {
    log.error(
      'This lead-routing.json was created with an older CLI version and has no SSH config. ' +
      'Please manually SSH into your server and run:\n\n' +
      '  cd ~/lead-routing && docker compose down -v && cd ~ && rm -rf ~/lead-routing'
    )
    process.exit(1)
  }

  // ── Confirmation ─────────────────────────────────────────────────────────
  log.warn(chalk.red('This will permanently destroy:'))
  log.warn(`  • Remote: ${cfg.ssh.username}@${cfg.ssh.host}:${cfg.remoteDir}`)
  log.warn('    └─ All containers, Postgres data, Redis data, config files')
  log.warn(`  • Local: ${dir}/`)
  log.warn('    └─ docker-compose.yml, .env.web, .env.engine, Caddyfile, lead-routing.json')

  const confirmed = await confirm({
    message: chalk.bold('Are you sure you want to uninstall? This cannot be undone.'),
    initialValue: false,
  })

  if (isCancel(confirmed) || !confirmed) {
    log.info('Uninstall cancelled.')
    process.exit(0)
  }

  // ── SSH auth ──────────────────────────────────────────────────────────────
  const ssh = new SshConnection()
  let sshPassword: string | undefined

  if (!cfg.ssh.privateKeyPath) {
    const pw = await promptPassword({
      message: `SSH password for ${cfg.ssh.username}@${cfg.ssh.host}`,
    })
    if (isCancel(pw)) process.exit(0)
    sshPassword = pw as string
  }

  try {
    await ssh.connect({
      host: cfg.ssh.host,
      port: cfg.ssh.port,
      username: cfg.ssh.username,
      privateKeyPath: cfg.ssh.privateKeyPath,
      password: sshPassword,
      remoteDir: cfg.remoteDir,
    })
    log.success(`Connected to ${cfg.ssh.host}`)
  } catch (err) {
    log.error(`SSH connection failed: ${String(err)}`)
    process.exit(1)
  }

  try {
    const remoteDir = await ssh.resolveHome(cfg.remoteDir)

    // ── Stop & remove containers + volumes ───────────────────────────────
    log.step('Stopping containers and removing volumes')
    const { code } = await ssh.execSilent('docker compose down -v', remoteDir)
    if (code !== 0) {
      log.warn('docker compose down reported an error — directory may already be partially removed')
    } else {
      log.success('Containers and volumes removed')
    }

    // ── Remove remote directory ───────────────────────────────────────────
    log.step(`Removing remote directory ${remoteDir}`)
    await ssh.exec(`rm -rf ${remoteDir}`)
    log.success('Remote directory removed')

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error(`Remote cleanup failed: ${message}`)
    process.exit(1)
  } finally {
    await ssh.disconnect()
  }

  // ── Remove local config dir ───────────────────────────────────────────────
  log.step('Removing local config directory')
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
    log.success(`Removed ${dir}`)
  }

  outro(
    chalk.green('✔  Uninstall complete.') +
    `\n\n  Run ${chalk.cyan('npx @lead-routing/cli init')} to start fresh.`
  )
}
