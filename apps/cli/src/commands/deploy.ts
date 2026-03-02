import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { intro, outro, log, password as promptPassword } from '@clack/prompts'
import chalk from 'chalk'
import { findInstallDir, readConfig } from '../utils/config.js'
import { SshConnection } from '../utils/ssh.js'
import { runMigrations } from '../steps/run-migrations.js'
import { renderCaddyfile } from '../templates/caddy.js'

export async function runDeploy(): Promise<void> {
  console.log()
  intro(chalk.bold.cyan('Lead Routing — Deploy'))

  const dir = findInstallDir()
  if (!dir) {
    log.error(
      'No lead-routing.json found. Run `lead-routing init` first, or run this command from your install directory.'
    )
    process.exit(1)
  }

  const cfg = readConfig(dir)!

  // ── Connect via SSH ──────────────────────────────────────────────────────
  const ssh = new SshConnection()
  let sshPassword: string | undefined

  if (!cfg.ssh.privateKeyPath) {
    // Password auth — not persisted in lead-routing.json; prompt again
    const pw = await promptPassword({
      message: `SSH password for ${cfg.ssh.username}@${cfg.ssh.host}`,
    })
    if (typeof pw === 'symbol') process.exit(0)
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
    // Resolve ~ to actual $HOME — node-ssh doesn't expand tilde in cwd
    const remoteDir = await ssh.resolveHome(cfg.remoteDir)

    // ── Sync Caddyfile ────────────────────────────────────────────────────
    // Regenerate from lead-routing.json so hostname changes (e.g. correcting
    // appUrl after init) are pushed to the VPS without manual edits.
    log.step('Syncing Caddyfile')
    const caddyContent = renderCaddyfile(cfg.appUrl, cfg.engineUrl)
    const tmpCaddy = join(tmpdir(), 'lead-routing-Caddyfile')
    writeFileSync(tmpCaddy, caddyContent, 'utf8')
    await ssh.upload([{ local: tmpCaddy, remote: `${remoteDir}/Caddyfile` }])
    unlinkSync(tmpCaddy)
    await ssh.exec('docker compose restart caddy', remoteDir)
    log.success('Caddyfile synced — waiting for TLS cert (~30s)')

    // ── Pull latest images ────────────────────────────────────────────────
    log.step('Pulling latest Docker images')
    await ssh.exec('docker compose pull', remoteDir)
    log.success('Images pulled')

    // ── Restart containers ────────────────────────────────────────────────
    log.step('Restarting services')
    await ssh.exec('docker compose up -d --remove-orphans', remoteDir)
    log.success('Services restarted')

    // ── Run migrations ────────────────────────────────────────────────────
    // No adminEmail/password — deploy only applies schema migrations, never re-seeds.
    log.step('Running database migrations')
    await runMigrations(ssh, dir)

    outro(
      chalk.green('✔  Deployment complete!') +
      `\n\n  ${chalk.cyan(cfg.appUrl)}`
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error(`Deploy failed: ${message}`)
    process.exit(1)
  } finally {
    await ssh.disconnect()
  }
}
