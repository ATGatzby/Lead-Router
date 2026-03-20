import { intro, outro, text, note, confirm, log, isCancel, cancel } from '@clack/prompts'
import chalk from 'chalk'
import { exec } from 'node:child_process'
import { platform } from 'node:os'
import { findInstallDir, readConfig } from '../utils/config.js'
import { sfdcDeployInline } from '../steps/sfdc-deploy-inline.js'

const MANAGED_PACKAGE_INSTALL_URL = 'https://login.salesforce.com/packaging/installPackage.apexp?p0=04tgL000000CTnp'

function openBrowser(url: string): void {
  const cmd = platform() === 'darwin' ? 'open' : 'xdg-open'
  exec(`${cmd} ${JSON.stringify(url)}`)
}

export async function runSfdcDeploy(): Promise<void> {
  intro('Lead Routing — Deploy Salesforce Package')

  // ── 1. Resolve appUrl + engineUrl ──────────────────────────────────────────
  // Prefer lead-routing.json if found; otherwise prompt (supports running sfdc
  // deploy from a laptop after init ran on a remote VPS).
  let appUrl: string
  let engineUrl: string

  const dir = findInstallDir()
  const config = dir ? readConfig(dir) : null

  if (config?.appUrl && config?.engineUrl) {
    appUrl = config.appUrl
    engineUrl = config.engineUrl
    log.info(`Using config from ${dir}/lead-routing.json`)
  } else {
    log.warn('No lead-routing.json found — enter the URLs from your installation.')
    const rawApp = await text({
      message: 'App URL (e.g. https://leads.acme.com)',
      validate: (v) => (!v ? 'Required' : undefined),
    })
    if (typeof rawApp === 'symbol') process.exit(0)
    appUrl = (rawApp as string).trim()

    const rawEngine = await text({
      message: 'Engine URL (e.g. https://engine.acme.com or https://acme.com:3001)',
      validate: (v) => (!v ? 'Required' : undefined),
    })
    if (typeof rawEngine === 'symbol') process.exit(0)
    engineUrl = (rawEngine as string).trim()
  }

  // ── 2. Install managed package ─────────────────────────────────────────────
  note(
    'The Lead Router managed package installs the required Connected App,\n' +
      'triggers, and custom objects in your Salesforce org.\n\n' +
      `Install URL: ${chalk.cyan(MANAGED_PACKAGE_INSTALL_URL)}`,
    'Salesforce Package'
  )
  log.info('Opening install URL in your browser...')
  openBrowser(MANAGED_PACKAGE_INSTALL_URL)
  log.info(chalk.dim("If the browser didn't open, visit the URL above manually."))

  const installed = await confirm({
    message: 'Have you installed the package? (Click "Install for All Users" in Salesforce)',
    initialValue: false,
  })
  if (isCancel(installed)) {
    cancel('Setup cancelled.')
    process.exit(0)
  }
  if (!installed) {
    log.warn('You can install the package later — routing will not work until it is installed.')
  } else {
    log.success('Salesforce package installed')
  }

  // ── 3. Prompt for org alias ────────────────────────────────────────────────
  const alias = await text({
    message: 'Salesforce org alias (used to log in)',
    placeholder: 'lead-routing',
    initialValue: 'lead-routing',
    validate: (v) => (!v ? 'Required' : undefined),
  })
  if (typeof alias === 'symbol') process.exit(0)

  // ── 4. Run shared deploy logic ─────────────────────────────────────────────
  try {
    await sfdcDeployInline({
      appUrl,
      engineUrl,
      orgAlias: alias as string,
      installDir: dir ?? undefined,
      webhookSecret: config?.engineWebhookSecret,
    })
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  // ── Done ────────────────────────────────────────────────────────────────────
  outro(
    chalk.green('✔  Salesforce package deployed!') +
    `\n\n  Your Lead Router dashboard: ${chalk.cyan(appUrl)}`
  )
}
