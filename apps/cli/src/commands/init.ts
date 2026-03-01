import { intro, outro, note, log } from '@clack/prompts'
import chalk from 'chalk'
import { checkPrerequisites } from '../steps/prerequisites.js'
import { collectSshConfig } from '../steps/collect-ssh-config.js'
import { collectConfig } from '../steps/collect-config.js'
import { generateFiles } from '../steps/generate-files.js'
import { checkRemotePrerequisites } from '../steps/check-remote-prerequisites.js'
import { uploadFiles } from '../steps/upload-files.js'
import { startServices } from '../steps/start-services.js'
import { runMigrations } from '../steps/run-migrations.js'
import { verifyHealth } from '../steps/verify-health.js'
import { sfdcDeployInline } from '../steps/sfdc-deploy-inline.js'
import { guideAppLauncherSetup } from '../steps/app-launcher-guide.js'
import { SshConnection } from '../utils/ssh.js'

export interface InitOptions {
  dryRun?: boolean
}

export async function runInit(options: InitOptions = {}): Promise<void> {
  const dryRun = options.dryRun ?? false

  console.log()
  intro(
    chalk.bold.cyan('Lead Routing — Self-Hosted Setup') +
      (dryRun ? chalk.yellow('  [dry run]') : '')
  )

  const ssh = new SshConnection()

  try {
    // Step 1 — Local prerequisites (Node.js + sf CLI)
    log.step('Step 1/9  Checking local prerequisites')
    await checkPrerequisites()

    // Step 2 — SSH connection details (prompts only, no connection yet)
    log.step('Step 2/9  Server connection')
    const sshCfg = await collectSshConfig()

    // Step 3 — App configuration
    log.step('Step 3/9  Configuration')
    const cfg = await collectConfig()

    // Step 4 — Generate config files locally (includes SSH details in lead-routing.json)
    log.step('Step 4/9  Generating config files')
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

    // Step 5 — Connect to server, verify Docker, upload files
    log.step('Step 5/9  Connecting to server')
    await ssh.connect(sshCfg)
    const remoteDir = await ssh.resolveHome(sshCfg.remoteDir)
    await checkRemotePrerequisites(ssh)
    await uploadFiles(ssh, dir, remoteDir)

    // Step 6 — Start services on remote server
    log.step('Step 6/9  Starting services')
    await startServices(ssh, remoteDir)

    // Step 7 — Migrations via SSH tunnel to remote Postgres
    log.step('Step 7/9  Database migrations')
    await runMigrations(ssh, dir, cfg.adminEmail, cfg.adminPassword)

    // Step 8 — Health check on public HTTPS URLs
    // (Caddy TLS cert provisioning takes ~30s — maxAttempts bumped to 24)
    log.step('Step 8/9  Verifying health')
    await verifyHealth(cfg.appUrl, cfg.engineUrl)

    // Step 9 — Deploy Salesforce package (sf runs locally — no VPS requirement)
    log.step('Step 9/9  Deploying Salesforce package')
    await sfdcDeployInline({
      appUrl: cfg.appUrl,
      engineUrl: cfg.engineUrl,
      orgAlias: cfg.orgAlias,
      sfdcClientId: cfg.sfdcClientId,
      sfdcLoginUrl: cfg.sfdcLoginUrl,
      installDir: dir,
    })

    // Guided App Launcher wizard
    await guideAppLauncherSetup(cfg.appUrl)

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
        `  ${chalk.cyan('2.')} Create your first routing rule to start routing leads\n\n` +
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
