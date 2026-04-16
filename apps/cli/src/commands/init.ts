import { promises as dns } from 'node:dns'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { exec } from 'node:child_process'
import { platform, homedir } from 'node:os'
import { join } from 'node:path'
import { intro, outro, note, log, confirm, cancel, isCancel, password as promptPassword, select, text } from '@clack/prompts'
import chalk from 'chalk'

/** Managed package install URL — mirrors packages/sfdc/src/constants.ts */
const MANAGED_PACKAGE_INSTALL_URL = 'https://login.salesforce.com/packaging/installPackage.apexp?p0=04tgL000000CTnp'
import { generateSecret } from '../utils/crypto.js'
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
  let authPassword: string | undefined
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
        authPassword = signupPw as string
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
        authPassword = loginPw as string
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

    // CRM selection — determines which integration steps to run
    const crmChoice = await select({
      message: 'Which CRM will you connect?',
      options: [
        { value: 'salesforce', label: 'Salesforce' },
        { value: 'hubspot', label: 'HubSpot' },
      ],
    })
    if (isCancel(crmChoice)) { cancel('Setup cancelled.'); process.exit(0) }
    const crmType = crmChoice as 'salesforce' | 'hubspot'

    // Step 2 — Install Salesforce Package (Salesforce only)
    if (crmType === 'salesforce') {
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
    } else {
      log.step('Step 2/9  HubSpot credentials (collected in step 5)')
      log.info('HubSpot credentials will be collected during configuration.')
    }

    // Step 3 — Local prerequisites (Node.js)
    log.step('Step 3/9  Checking local prerequisites')
    await checkPrerequisites()

    // Step 4 — SSH connection details + immediate connection test
    log.step('Step 4/9  SSH connection')
    let sshCfg = await collectSshConfig({
      sshPort: options.sshPort,
      sshUser: options.sshUser,
      sshKey: options.sshKey,
      remoteDir: options.remoteDir,
    })

    if (!dryRun) {
      let sshConnected = false
      while (!sshConnected) {
        try {
          await ssh.connect(sshCfg)
          log.success(`Connected to ${sshCfg.host}`)
          sshConnected = true
        } catch (err) {
          log.error(`SSH connection failed: ${String(err)}`)
          const retry = await confirm({ message: 'Re-enter SSH details and try again?' })
          if (isCancel(retry) || !retry) {
            cancel('Setup cancelled.')
            process.exit(0)
          }
          sshCfg = await collectSshConfig({
            sshPort: options.sshPort,
            sshUser: options.sshUser,
            sshKey: options.sshKey,
            remoteDir: options.remoteDir,
          })
        }
      }
    }

    // Step 5 — App configuration
    log.step('Step 5/9  Configuration')
    let cfg = await collectConfig({
      externalDb: options.externalDb,
      externalRedis: options.externalRedis,
      crmType,
    }, auth.customer.email, authPassword)

    // DNS pre-flight
    await checkDnsResolvable(cfg.appUrl, cfg.engineUrl)

    // ── Agent API ─────────────────────────────────────────────────
    const enableAgentApi = await confirm({
      message: 'Enable AI agent API? (Langfuse eval dashboard + MCP composite tools)',
      initialValue: true,
    })
    if (isCancel(enableAgentApi)) { cancel('Setup cancelled.'); process.exit(0) }

    let langfuseUrl = cfg.langfuseUrl
    let langfuseSecret = ''
    let langfuseSalt = ''
    if (enableAgentApi) {
      langfuseSecret = generateSecret(32)
      langfuseSalt = generateSecret(16)
    }

    // Step 6 — Generate config files locally
    log.step('Step 6/9  Generating config files')
    const { dir } = generateFiles(cfg, sshCfg, {
      licenseKey: licenseResult.key,
      licenseTier: licenseResult.tier,
    }, enableAgentApi ? {
      langfuseUrl,
      langfuseSecret,
      langfuseSalt,
      dbPassword: cfg.dbPassword,
    } : undefined)

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

    // Create Langfuse database if agent API is enabled
    if (enableAgentApi) {
      log.step('Creating Langfuse database...')
      await ssh.exec(`docker exec $(docker ps -qf "name=postgres") psql -U leadrouting -d postgres -c "CREATE DATABASE langfuse OWNER leadrouting;" 2>/dev/null || true`)
      // Restart langfuse to pick up the new DB
      await ssh.exec(`cd ${remoteDir} && docker compose restart langfuse`)
      log.success('Langfuse database created')
    }

    // Step 9 — Health check on public HTTPS URLs
    log.step('Step 9/9  Verifying health')
    let healthy = false
    while (!healthy) {
      try {
        await verifyHealth(cfg.appUrl, cfg.engineUrl, ssh, remoteDir)
        healthy = true
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error(`Health check failed: ${message}`)
        const retry = await confirm({ message: 'Re-enter URLs and retry?' })
        if (isCancel(retry) || !retry) {
          log.info(`Run ${chalk.cyan('lead-routing init --resume')} to retry health checks later.`)
          process.exit(1)
        }
        // Re-collect just the URLs
        const newAppUrl = await text({
          message: 'App URL',
          initialValue: cfg.appUrl,
          validate: (v) => {
            if (!v) return 'Required'
            try { const u = new URL(v); if (u.protocol !== 'https:') return 'Must be HTTPS' } catch { return 'Invalid URL' }
          },
        })
        if (isCancel(newAppUrl)) { cancel('Setup cancelled.'); process.exit(0) }
        const newEngineUrl = await text({
          message: 'Engine URL',
          initialValue: cfg.engineUrl,
          validate: (v) => {
            if (!v) return 'Required'
            try { const u = new URL(v); if (u.protocol !== 'https:') return 'Must be HTTPS' } catch { return 'Invalid URL' }
          },
        })
        if (isCancel(newEngineUrl)) { cancel('Setup cancelled.'); process.exit(0) }

        cfg.appUrl = (newAppUrl as string).trim().replace(/\/+$/, '')
        cfg.engineUrl = (newEngineUrl as string).trim().replace(/\/+$/, '')

        // Regenerate files with new URLs and re-upload
        log.step('Regenerating config files with new URLs...')
        const { dir: newDir } = generateFiles(cfg, sshCfg, {
          licenseKey: licenseResult.key,
          licenseTier: licenseResult.tier,
        }, enableAgentApi ? {
          langfuseUrl,
          langfuseSecret,
          langfuseSalt,
          dbPassword: cfg.dbPassword,
        } : undefined)
        await uploadFiles(ssh, newDir, remoteDir)
        log.step('Restarting services with new config...')
        await startServices(ssh, remoteDir)
        log.step('Retrying health check...')
      }
    }

    note(
      `You can log in to the web app at ${chalk.cyan(cfg.appUrl)} with:\n` +
        `  Email:    ${cfg.adminEmail}\n` +
        `  Password: (the password you set during setup)`,
      'Admin Login'
    )

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

    if (crmType === 'salesforce') {
      note(
        `Open ${cfg.appUrl} → Integrations → Salesforce to connect your org.\n` +
          'The managed package is already installed — just click "Connect Salesforce" to authorize.',
        'Next: Connect Salesforce'
      )
    } else {
      note(
        `Open ${cfg.appUrl} → Integrations → HubSpot to connect your portal.\n` +
          'Click "Connect HubSpot" to authorize the integration.',
        'Next: Connect HubSpot'
      )
    }

    // Write ~/.lead-routing/mcp.json for zero-config MCP server
    try {
      let webhookSecret = ''
      const envEngineContent = readFileSync(join(dir, '.env.engine'), 'utf-8')
      const wsMatch = envEngineContent.match(/^(?:ENGINE_)?WEBHOOK_SECRET=(.+)$/m)
      if (wsMatch) webhookSecret = wsMatch[1].trim()

      // Auto-generate API token by logging into the web app
      let apiToken = ''
      if (webhookSecret) {
        try {
          log.step('Generating MCP API token...')
          // Login to get session cookie
          const loginRes = await fetch(`${cfg.appUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: cfg.adminEmail, password: cfg.adminPassword }),
            redirect: 'manual',
          })
          if (loginRes.ok) {
            // Extract set-cookie header for session
            const cookies = loginRes.headers.getSetCookie?.() ?? []
            const cookieHeader = cookies.join('; ')

            // Create API token
            const tokenRes = await fetch(`${cfg.appUrl}/api/tokens`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Cookie': cookieHeader,
              },
              body: JSON.stringify({ name: 'Claude Code MCP', scopes: ['read', 'write', 'route', 'agent'] }),
            })
            if (tokenRes.ok) {
              const tokenData = await tokenRes.json() as { token: string }
              apiToken = tokenData.token
              log.success('MCP API token created')
            }
          }
        } catch { /* non-fatal — MCP will work without apiToken for engine-only calls */ }
      }

      if (webhookSecret) {
        const mcpDir = join(homedir(), '.lead-routing')
        mkdirSync(mcpDir, { recursive: true })
        const mcpConfig: Record<string, string> = { appUrl: cfg.appUrl, engineUrl: cfg.engineUrl, webhookSecret, crmType: cfg.crmType || 'salesforce' }
        if (cfg.mcpUrl) mcpConfig.mcpUrl = cfg.mcpUrl
        if (apiToken) mcpConfig.apiToken = apiToken
        writeFileSync(
          join(mcpDir, 'mcp.json'),
          JSON.stringify(mcpConfig, null, 2),
          'utf-8'
        )

        // Update docker-compose with API token and restart MCP container
        if (apiToken) {
          try {
            const composePath = join(dir, 'docker-compose.yml')
            const composeContent = readFileSync(composePath, 'utf-8')
            const updated = composeContent.replace(
              /API_TOKEN:\s*.*/,
              `API_TOKEN: ${apiToken}`
            )
            writeFileSync(composePath, updated, 'utf-8')
            await uploadFiles(ssh, dir, remoteDir)
            await ssh.exec(`cd ${remoteDir} && docker compose up -d --force-recreate mcp 2>&1`)
            log.success('MCP container updated with API token')
          } catch {
            // Non-fatal — MCP OAuth still works, just direct API calls won't
          }
        }

        note(
          'Connect Lead Routing to Claude Code with one command:\n\n' +
            chalk.cyan('claude mcp add lead-routing -- npx -y @lead-routing/mcp'),
          'Claude Code MCP'
        )
      }
    } catch { /* non-fatal */ }

    // Done
    const crmSteps = crmType === 'salesforce'
      ? `  ${chalk.cyan('2.')} Go to Integrations → Salesforce → Connect\n` +
        `  ${chalk.cyan('3.')} Complete the onboarding wizard in Salesforce\n`
      : `  ${chalk.cyan('2.')} Go to Integrations → HubSpot → Connect\n` +
        `  ${chalk.cyan('3.')} Authorize the HubSpot integration\n`

    const agentApiLines = enableAgentApi
      ? `  Evals:          ${chalk.cyan(cfg.langfuseUrl)}\n` +
        `  MCP:            ${chalk.cyan(cfg.mcpUrl)}\n` +
        `  MCP config:     ~/.lead-routing/mcp.json\n`
      : ''

    const dnsLine = cfg.baseDomain
      ? `\n  DNS: Add ${chalk.white(`*.${cfg.baseDomain}`)} -> A -> <server IP>\n`
      : ''

    outro(
      chalk.green("✔  You're live!") +
        '\n\n' +
        `  Dashboard:      ${chalk.cyan(cfg.appUrl)}\n` +
        `  Engine:         ${chalk.cyan(cfg.engineUrl)}\n` +
        agentApiLines +
        '\n' +
        `  Admin email:    ${chalk.white(cfg.adminEmail)}\n` +
        dnsLine +
        '\n' +
        chalk.bold('  Next steps:\n') +
        `  ${chalk.cyan('1.')} Open ${chalk.cyan(cfg.appUrl)} and log in\n` +
        crmSteps +
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
