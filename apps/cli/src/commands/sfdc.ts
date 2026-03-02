import { intro, outro, text, spinner, log } from '@clack/prompts'
import chalk from 'chalk'
import { execa } from 'execa'
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

  // ── 2. Check sf CLI ────────────────────────────────────────────────────────
  // (Not covered by prerequisites here — sfdc deploy can run standalone)
  const s = spinner()
  s.start('Checking Salesforce CLI…')
  try {
    await execa('sf', ['--version'], { all: true })
    s.stop('Salesforce CLI found')
  } catch {
    s.stop('Salesforce CLI (sf) not found')
    log.error(
      'Install the Salesforce CLI and re-run this command:\n' +
      '  https://developer.salesforce.com/tools/salesforcecli'
    )
    process.exit(1)
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
      // Read from config if available; alreadyAuthed check will skip login if already logged in
      sfdcClientId: config?.sfdcClientId ?? '',
      sfdcLoginUrl: config?.sfdcLoginUrl ?? 'https://login.salesforce.com',
      installDir: dir ?? undefined,
    })
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  // ── 5. Interactive App Launcher wizard ─────────────────────────────────────
  await guideAppLauncherSetup(appUrl)

  // ── Done ────────────────────────────────────────────────────────────────────
  outro(
    chalk.green('✔  Salesforce package deployed!') +
    `\n\n  Your Lead Router dashboard: ${chalk.cyan(appUrl)}`
  )
}
