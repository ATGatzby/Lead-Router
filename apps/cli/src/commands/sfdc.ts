import { intro, outro, text, log } from '@clack/prompts'
import chalk from 'chalk'
import { findInstallDir, readConfig } from '../utils/config.js'
import { sfdcDeployInline } from '../steps/sfdc-deploy-inline.js'
import { guideAppLauncherSetup } from '../steps/app-launcher-guide.js'

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

  // ── 2. Prompt for org alias ────────────────────────────────────────────────
  const alias = await text({
    message: 'Salesforce org alias (used to log in)',
    placeholder: 'lead-routing',
    initialValue: 'lead-routing',
    validate: (v) => (!v ? 'Required' : undefined),
  })
  if (typeof alias === 'symbol') process.exit(0)

  // ── 3. Run shared deploy logic ─────────────────────────────────────────────
  try {
    await sfdcDeployInline({
      appUrl,
      engineUrl,
      orgAlias: alias as string,
      // Read from config if available
      sfdcClientId: config?.sfdcClientId ?? '',
      sfdcLoginUrl: config?.sfdcLoginUrl ?? 'https://login.salesforce.com',
      installDir: dir ?? undefined,
      webhookSecret: config?.engineWebhookSecret,
    })
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  // ── 4. Interactive App Launcher wizard ─────────────────────────────────────
  await guideAppLauncherSetup(appUrl)

  // ── Done ────────────────────────────────────────────────────────────────────
  outro(
    chalk.green('✔  Salesforce package deployed!') +
    `\n\n  Your Lead Router dashboard: ${chalk.cyan(appUrl)}`
  )
}
