import { promises as dns } from 'node:dns'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { intro, outro, note, log, confirm, cancel, isCancel, password as promptPassword } from '@clack/prompts'
import chalk from 'chalk'
import { checkPrerequisites } from '../steps/prerequisites.js'
import { collectSshConfig } from '../steps/collect-ssh-config.js'
import { collectConfig } from '../steps/collect-config.js'
import { generateFiles } from '../steps/generate-files.js'
import { checkRemotePrerequisites } from '../steps/check-remote-prerequisites.js'
import { uploadFiles } from '../steps/upload-files.js'
import { startServices } from '../steps/start-services.js'
import { verifyHealth } from '../steps/verify-health.js'
import { SshConnection } from '../utils/ssh.js'
import { findInstallDir, readConfig } from '../utils/config.js'

export interface InitOptions {
  dryRun?: boolean
  resume?: boolean
  sshPort?: number
  sshUser?: string
  sshKey?: string
  remoteDir?: string
  externalDb?: string
  externalRedis?: string
}

// Warn (not error) when a hostname doesn't resolve — DNS can lag on new domains.
async function checkDnsResolvable(appUrl: string, engineUrl: string): Promise<void> {
  let hosts: string[]
  try {
    hosts = [...new Set([new URL(appUrl).hostname, new URL(engineUrl).hostname])]
  } catch {
    return
  }

  for (const host of hosts) {
    try {
      await dns.lookup(host)
    } catch {
      log.warn(
        `${chalk.yellow(host)} does not resolve in DNS yet.\n` +
          '  Check for typos — a bad domain will cause a 2-minute timeout at step 7.'
      )
      const go = await confirm({ message: 'Continue anyway?', initialValue: true })
      if (isCancel(go) || !go) {
        cancel('Setup cancelled.')
        process.exit(0)
      }
    }
  }
}

export async function runInit(options: InitOptions = {}): Promise<void> {
  const dryRun = options.dryRun ?? false
  const resume = options.resume ?? false

  console.log()
  intro(
    chalk.bold.cyan('Lead Routing — Self-Hosted Setup') +
      (dryRun ? chalk.yellow('  [dry run]') : '') +
      (resume ? chalk.yellow('  [resume]') : '')
  )

  const ssh = new SshConnection()

  // ── Resume branch: skip steps 1-6, reconnect, run health check ──────────────
  if (resume) {
    try {
      const dir = findInstallDir()
      if (!dir) {
        log.error('No lead-routing.json found — run `lead-routing init` first.')
        process.exit(1)
      }
      const saved = readConfig(dir)!

      // Re-prompt SSH password if key auth is not configured
      let sshPassword: string | undefined
      if (!saved.ssh.privateKeyPath) {
        const pw = await promptPassword({
          message: `SSH password for ${saved.ssh.username}@${saved.ssh.host}`,
        })
        if (typeof pw === 'symbol') process.exit(0)
        sshPassword = pw as string
      }

      log.step('Connecting to server')
      await ssh.connect({
        host: saved.ssh.host,
        port: saved.ssh.port,
        username: saved.ssh.username,
        privateKeyPath: saved.ssh.privateKeyPath,
        password: sshPassword,
        remoteDir: saved.remoteDir,
      })
      log.success(`Connected to ${saved.ssh.host}`)
      const remoteDir = await ssh.resolveHome(saved.remoteDir)

      log.step('Step 7/7  Verifying health')
      await verifyHealth(saved.appUrl, saved.engineUrl, ssh, remoteDir)

      note(
        `Open ${saved.appUrl} → Integrations → Salesforce to connect your CRM and deploy the package.`,
        'Next: Connect Salesforce'
      )

      outro(
        chalk.green("✔  You're live!") +
          '\n\n' +
          `  Dashboard:      ${chalk.cyan(saved.appUrl)}\n` +
          `  Routing engine: ${chalk.cyan(saved.engineUrl)}\n\n` +
          chalk.bold('  Next steps:\n') +
          `  ${chalk.cyan('1.')} Open ${chalk.cyan(saved.appUrl)} and log in\n` +
          `  ${chalk.cyan('2.')} Go to Integrations → Salesforce to connect your org\n` +
          `  ${chalk.cyan('3.')} Deploy the package and configure routing objects\n` +
          `  ${chalk.cyan('4.')} Create your first routing rule\n\n` +
          `  Run ${chalk.cyan('lead-routing doctor')} to check service health at any time.\n` +
          `  Run ${chalk.cyan('lead-routing deploy')} to update to a new version.`
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`Resume failed: ${message}`)
      process.exit(1)
    } finally {
      await ssh.disconnect()
    }
    return
  }

  // ── Full init flow ───────────────────────────────────────────────────────────
  try {
    // Step 1 — Local prerequisites (Node.js + sf CLI)
    log.step('Step 1/7  Checking local prerequisites')
    await checkPrerequisites()

    // Step 2 — SSH connection details + immediate connection test
    // Connect before collecting app config so SSH errors surface early
    // (not after the user has spent 5 minutes filling in URLs and credentials).
    log.step('Step 2/7  SSH connection')
    const sshCfg = await collectSshConfig({
      sshPort: options.sshPort,
      sshUser: options.sshUser,
      sshKey: options.sshKey,
      remoteDir: options.remoteDir,
    })

    if (!dryRun) {
      try {
        await ssh.connect(sshCfg)
        log.success(`Connected to ${sshCfg.host}`)
      } catch (err) {
        log.error(`SSH connection failed: ${String(err)}`)
        log.info('Check your password and re-run `lead-routing init`.')
        process.exit(1)
      }
    }

    // Step 3 — App configuration (only reached after SSH is confirmed working)
    log.step('Step 3/7  Configuration')
    const cfg = await collectConfig({
      externalDb: options.externalDb,
      externalRedis: options.externalRedis,
    })

    // DNS pre-flight: warn if hostnames don't resolve (non-blocking, asks to continue)
    await checkDnsResolvable(cfg.appUrl, cfg.engineUrl)

    // Step 4 — Generate config files locally
    log.step('Step 4/7  Generating config files')
    const { dir, adminSecret } = generateFiles(cfg, sshCfg)

    note(
      `Local config directory: ${chalk.cyan(dir)}\n` +
        'Files created: docker-compose.yml, Caddyfile, .env.web, .env.engine, lead-routing.json',
      'Files'
    )

    if (dryRun) {
      outro(
        chalk.yellow('Dry run complete — no connection made, no services started.') +
          '\n\n' +
          `  Config files written to: ${chalk.cyan(dir)}\n\n` +
          `  When ready, run ${chalk.cyan('lead-routing init')} (without --dry-run) to deploy.`
      )
      return
    }

    // Step 5 — Remote setup (already connected from step 2)
    log.step('Step 5/7  Remote setup')
    const remoteDir = await ssh.resolveHome(sshCfg.remoteDir)
    await checkRemotePrerequisites(ssh)
    await uploadFiles(ssh, dir, remoteDir)

    // Step 6 — Start services on remote server
    // (migrations + seed now run inside the web container on startup)
    log.step('Step 6/7  Starting services')
    await startServices(ssh, remoteDir)

    // Step 7 — Health check on public HTTPS URLs
    // (Caddy TLS cert provisioning takes ~30s — maxAttempts bumped to 24)
    log.step('Step 7/7  Verifying health')
    await verifyHealth(cfg.appUrl, cfg.engineUrl, ssh, remoteDir)

    // Remove ADMIN_PASSWORD from .env.web now that the seed has run
    try {
      const envWebPath = join(dir, '.env.web')
      const envContent = readFileSync(envWebPath, 'utf-8')
      const cleaned = envContent
        .split('\n')
        .filter((line) => !line.startsWith('ADMIN_PASSWORD='))
        .join('\n')
      writeFileSync(envWebPath, cleaned, 'utf-8')
      log.success('Removed ADMIN_PASSWORD from .env.web (no longer needed after seed)')
    } catch {
      // Non-fatal — password stays in .env.web but won't cause issues
    }

    note(
      `Open ${cfg.appUrl} → Integrations → Salesforce to connect your CRM and deploy the package.`,
      'Next: Connect Salesforce'
    )

    // Done
    outro(
      chalk.green("✔  You're live!") +
        '\n\n' +
        `  Dashboard:      ${chalk.cyan(cfg.appUrl)}\n` +
        `  Routing engine: ${chalk.cyan(cfg.engineUrl)}\n\n` +
        `  Admin email:    ${chalk.white(cfg.adminEmail)}\n` +
        `  Admin secret:   ${chalk.yellow(adminSecret)}\n` +
        `                  ${chalk.dim('run `lead-routing config show` to retrieve later')}\n\n` +
        chalk.bold('  Next steps:\n') +
        `  ${chalk.cyan('1.')} Open ${chalk.cyan(cfg.appUrl)} and log in\n` +
        `  ${chalk.cyan('2.')} Go to Integrations → Salesforce to connect your org\n` +
        `  ${chalk.cyan('3.')} Deploy the package and configure routing objects\n` +
        `  ${chalk.cyan('4.')} Create your first routing rule\n\n` +
        `  Run ${chalk.cyan('lead-routing doctor')} to check service health at any time.\n` +
        `  Run ${chalk.cyan('lead-routing deploy')} to update to a new version.`
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error(`Setup failed: ${message}`)
    process.exit(1)
  } finally {
    await ssh.disconnect()
  }
}
