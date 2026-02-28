import { intro, outro, note, log } from '@clack/prompts'
import chalk from 'chalk'
import { checkPrerequisites } from '../steps/prerequisites.js'
import { collectConfig } from '../steps/collect-config.js'
import { generateFiles } from '../steps/generate-files.js'
import { startServices } from '../steps/start-services.js'
import { runMigrations, seedAdminUser } from '../steps/run-migrations.js'
import { verifyHealth } from '../steps/verify-health.js'

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

  try {
    // Step 1 — Prerequisites
    log.step('Step 1/6  Checking prerequisites')
    await checkPrerequisites()

    // Step 2 — Collect config
    log.step('Step 2/6  Configuration')
    const cfg = await collectConfig()

    // Step 3 — Generate files
    log.step('Step 3/6  Generating config files')
    const { dir, adminSecret } = generateFiles(cfg)

    note(
      `Install directory: ${chalk.cyan(dir)}\n` +
        'Files created: docker-compose.yml, Caddyfile, .env.web, .env.engine, lead-routing.json',
      'Files'
    )

    if (dryRun) {
      outro(
        chalk.yellow('Dry run complete — no services were started.') +
          '\n\n' +
          `  Config files written to: ${chalk.cyan(dir)}\n\n` +
          `  When ready, run ${chalk.cyan('lead-routing init')} (without --dry-run) to deploy,\n` +
          `  or ${chalk.cyan('docker compose up -d')} from ${chalk.cyan(dir)} directly.`
      )
      return
    }

    // Step 4 — Start services
    log.step('Step 4/6  Starting services')
    await startServices(dir)

    // Step 5 — Migrations + seed
    log.step('Step 5/6  Running database migrations')
    await runMigrations(dir, cfg.adminEmail, cfg.adminPassword)
    await seedAdminUser(dir, cfg.adminEmail, cfg.adminPassword)

    // Step 6 — Verify health (use localhost — SSL cert not ready during init)
    log.step('Step 6/6  Verifying health')
    await verifyHealth('http://localhost:3000', 'http://localhost:3001')

    // Derived values for next steps display
    const callbackUrl = `${cfg.appUrl}/api/auth/callback`
    const appHost = new URL(cfg.appUrl).hostname
    const engineHost = new URL(cfg.engineUrl).hostname
    const enginePort = new URL(cfg.engineUrl).port

    // Done
    outro(
      chalk.green('✔  Setup complete!') +
        '\n\n' +
        `  Web app:        ${chalk.cyan(cfg.appUrl)}\n` +
        `  Routing engine: ${chalk.cyan(cfg.engineUrl)}\n\n` +
        `  Admin email:    ${chalk.white(cfg.adminEmail)}\n` +
        `  Admin secret:   ${chalk.yellow(adminSecret)}\n` +
        `                  ${chalk.dim('run `lead-routing config show` to retrieve later')}\n\n` +
        chalk.bold('  Next steps:\n') +
        `  ${chalk.cyan('1.')} Ensure DNS A records for ${chalk.white(appHost)}${engineHost !== appHost ? ` and ${chalk.white(engineHost)}` : ''}\n` +
        `     point to this server — Caddy will auto-provision SSL certificates\n` +
        `  ${chalk.cyan('2.')} Open firewall ports ${chalk.white('80')} and ${chalk.white('443')}${enginePort ? ` and ${chalk.white(enginePort)}` : ''}\n` +
        `  ${chalk.cyan('3.')} Update your Salesforce Connected App callback URL to:\n` +
        `     ${chalk.white(callbackUrl)}\n` +
        `  ${chalk.cyan('4.')} Run ${chalk.cyan('lead-routing sfdc deploy')} to install Apex triggers\n` +
        `  ${chalk.cyan('5.')} Open Salesforce → App Launcher → ${chalk.white('Lead Router Setup')}\n` +
        `     → Connect to Lead Router → complete the 4-step wizard\n\n` +
        `  Run ${chalk.cyan('lead-routing doctor')} to check service health at any time.\n` +
        `  Run ${chalk.cyan('lead-routing deploy')} to update to a new version.`
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error(`Setup failed: ${message}`)
    process.exit(1)
  }
}
