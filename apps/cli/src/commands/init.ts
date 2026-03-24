import { promises as dns } from 'node:dns'
import { readFileSync, writeFileSync } from 'node:fs'
import { exec } from 'node:child_process'
import { platform } from 'node:os'
import { join } from 'node:path'
import { intro, outro, note, log, confirm, cancel, isCancel, password as promptPassword, select, text } from '@clack/prompts'
import chalk from 'chalk'

/** Managed package install URL — mirrors packages/sfdc/src/constants.ts */
const MANAGED_PACKAGE_INSTALL_URL = 'https://login.salesforce.com/packaging/installPackage.apexp?p0=04tgL000000CTnp'
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
import { requireAuth, saveCredentials, apiLogin, apiSignup, apiResendVerification, type StoredCredentials } from '../utils/auth.js'
import { formatTierBadge } from '../utils/license.js'

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

/** Open a URL in the user's default browser. */
function openBrowser(url: string): void {
  const cmd = platform() === 'darwin' ? 'open' : 'xdg-open'
  exec(`${cmd} ${JSON.stringify(url)}`)
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

      log.step('Verifying health')
      await verifyHealth(saved.appUrl, saved.engineUrl, ssh, remoteDir)

      outro(chalk.green("✔  Services are healthy!"))
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

  // ── Auth check (inline signup/login if needed) ──
  let auth: StoredCredentials
  try {
    auth = await requireAuth()
  } catch {
    // Not logged in — offer inline signup or login
    const action = await select({
      message: 'You need an account to continue. What would you like to do?',
      options: [
        { value: 'signup', label: 'Create a new account' },
        { value: 'login', label: 'Log in to existing account' },
      ],
    })
    if (isCancel(action)) { cancel('Setup cancelled.'); process.exit(0) }

    if (action === 'signup') {
      const firstName = await text({ message: 'First name', placeholder: 'John', validate: (v) => v.trim() ? undefined : 'Required' })
      if (isCancel(firstName)) { cancel('Setup cancelled.'); process.exit(0) }
      const lastName = await text({ message: 'Last name', placeholder: 'Smith', validate: (v) => v.trim() ? undefined : 'Required' })
      if (isCancel(lastName)) { cancel('Setup cancelled.'); process.exit(0) }
      const signupEmail = await text({ message: 'Email', placeholder: 'john@acme.com', validate: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? undefined : 'Invalid email' })
      if (isCancel(signupEmail)) { cancel('Setup cancelled.'); process.exit(0) }
      const signupPw = await promptPassword({ message: 'Password (min 8 characters)', validate: (v) => v.length >= 8 ? undefined : 'Must be at least 8 characters' })
      if (isCancel(signupPw)) { cancel('Setup cancelled.'); process.exit(0) }
      const confirmPw = await promptPassword({ message: 'Confirm password', validate: (v) => v === signupPw ? undefined : 'Passwords do not match' })
      if (isCancel(confirmPw)) { cancel('Setup cancelled.'); process.exit(0) }

      log.step('Creating account...')
      try {
        await apiSignup({ firstName: (firstName as string).trim(), lastName: (lastName as string).trim(), email: (signupEmail as string).trim(), password: signupPw as string })
        log.success('Account created!')
      } catch (err) {
        log.error(err instanceof Error ? err.message : 'Signup failed')
        process.exit(1)
      }

      note(
        `Check your email (${(signupEmail as string).trim()}) for a verification link.\n` +
        'After verifying, press Enter to continue.',
        'Verify Email'
      )
      await text({ message: 'Press Enter once you\'ve verified your email...', defaultValue: '' })

      // Now log them in
      log.step('Logging in...')
      try {
        const { token, customer } = await apiLogin((signupEmail as string).trim(), signupPw as string)
        if (!customer.emailVerified) {
          log.warn('Email not verified yet.')
          const resend = await confirm({ message: 'Resend verification email?' })
          if (resend && !isCancel(resend)) {
            await apiResendVerification(token).catch(() => {})
            log.info('Verification email sent. Verify and re-run `lead-routing init`.')
          }
          process.exit(1)
        }
        saveCredentials({ token, customer, storedAt: new Date().toISOString() })
        auth = { token, customer, storedAt: new Date().toISOString() }
      } catch (err) {
        log.error(err instanceof Error ? err.message : 'Login failed')
        process.exit(1)
      }
    } else {
      // Login flow
      const loginEmail = await text({ message: 'Email', placeholder: 'john@acme.com' })
      if (isCancel(loginEmail)) { cancel('Setup cancelled.'); process.exit(0) }
      const loginPw = await promptPassword({ message: 'Password' })
      if (isCancel(loginPw)) { cancel('Setup cancelled.'); process.exit(0) }

      log.step('Authenticating...')
      try {
        const { token, customer } = await apiLogin((loginEmail as string).trim(), loginPw as string)
        if (!customer.emailVerified) {
          log.warn('Email not verified yet.')
          const resend = await confirm({ message: 'Resend verification email?' })
          if (resend && !isCancel(resend)) {
            await apiResendVerification(token).catch(() => {})
            log.info('Verification email sent. Verify and re-run `lead-routing init`.')
          }
          process.exit(1)
        }
        saveCredentials({ token, customer, storedAt: new Date().toISOString() })
        auth = { token, customer, storedAt: new Date().toISOString() }
      } catch (err) {
        log.error(err instanceof Error ? err.message : 'Login failed')
        process.exit(1)
      }
    }
  }

  log.success(`Logged in as ${auth.customer.firstName} ${auth.customer.lastName} — ${formatTierBadge(auth.customer.tier)}`)

  try {
    // Step 1 — License tier (from account)
    log.step('Step 1/9  License validation')
    const licenseResult = { tier: auth.customer.tier as 'free' | 'pro', key: undefined as string | undefined }

    // Step 2 — Install Salesforce Package
    log.step('Step 2/9  Install Salesforce Package')
    note(
      'The Lead Router managed package installs the required Connected App,\n' +
        'triggers, and custom objects in your Salesforce org.\n\n' +
        `Install URL: ${chalk.cyan(MANAGED_PACKAGE_INSTALL_URL)}`,
      'Salesforce Package'
    )
    log.info('Opening install URL in your browser...')
    openBrowser(MANAGED_PACKAGE_INSTALL_URL)
    log.info(`${chalk.dim('If the browser didn\'t open, visit the URL above manually.')}`)

    const installed = await confirm({
      message: 'Have you installed the package? (Click "Install for All Users" in Salesforce)',
      initialValue: false,
    })
    if (isCancel(installed)) {
      cancel('Setup cancelled.')
      process.exit(0)
    }
    if (!installed) {
      log.warn('You can install the package later from Integrations → Salesforce in the web app.')
    } else {
      log.success('Salesforce package installed')
    }

    // Step 3 — Local prerequisites (Node.js)
    log.step('Step 3/9  Checking local prerequisites')
    await checkPrerequisites()

    // Step 4 — SSH connection details + immediate connection test
    log.step('Step 4/9  SSH connection')
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

    // Step 5 — App configuration
    log.step('Step 5/9  Configuration')
    const cfg = await collectConfig({
      externalDb: options.externalDb,
      externalRedis: options.externalRedis,
    })

    // DNS pre-flight
    await checkDnsResolvable(cfg.appUrl, cfg.engineUrl)

    // Step 6 — Generate config files locally
    log.step('Step 6/9  Generating config files')
    const { dir } = generateFiles(cfg, sshCfg, {
      licenseKey: licenseResult.key,
      licenseTier: licenseResult.tier,
    })

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

    // Step 7 — Remote setup (already connected from step 4)
    log.step('Step 7/9  Remote setup')
    const remoteDir = await ssh.resolveHome(sshCfg.remoteDir)
    await checkRemotePrerequisites(ssh)
    await uploadFiles(ssh, dir, remoteDir)

    // Step 8 — Start services on remote server
    log.step('Step 8/9  Starting services')
    await startServices(ssh, remoteDir)

    // Step 9 — Health check on public HTTPS URLs
    log.step('Step 9/9  Verifying health')
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
      // Non-fatal
    }

    note(
      `Open ${cfg.appUrl} → Integrations → Salesforce to connect your org.\n` +
        'The managed package is already installed — just click "Connect Salesforce" to authorize.',
      'Next: Connect Salesforce'
    )

    // Generate MCP command for Claude Code
    let webhookSecret = ''
    try {
      const envEngineContent = readFileSync(join(dir, '.env.engine'), 'utf-8')
      const match = envEngineContent.match(/^WEBHOOK_SECRET=(.+)$/m)
      if (match) webhookSecret = match[1].trim()
    } catch { /* non-fatal */ }

    if (webhookSecret) {
      const mcpCmd =
        `claude mcp add lead-routing \\\n` +
        `  -e APP_URL=${cfg.appUrl} \\\n` +
        `  -e ENGINE_URL=${cfg.engineUrl} \\\n` +
        `  -e WEBHOOK_SECRET=${webhookSecret} \\\n` +
        `  -- npx -y @lead-routing/mcp`
      note(
        'Paste this command in your terminal to connect Lead Routing to Claude Code:\n\n' +
          chalk.cyan(mcpCmd),
        'Claude Code MCP'
      )
    }

    // Done
    outro(
      chalk.green("✔  You're live!") +
        '\n\n' +
        `  Dashboard:      ${chalk.cyan(cfg.appUrl)}\n` +
        `  Routing engine: ${chalk.cyan(cfg.engineUrl)}\n\n` +
        `  Admin email:    ${chalk.white(cfg.adminEmail)}\n\n` +
        chalk.bold('  Next steps:\n') +
        `  ${chalk.cyan('1.')} Open ${chalk.cyan(cfg.appUrl)} and log in\n` +
        `  ${chalk.cyan('2.')} Go to Integrations → Salesforce → Connect\n` +
        `  ${chalk.cyan('3.')} Complete the onboarding wizard in Salesforce\n` +
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
