import { readFileSync, writeFileSync, existsSync, cpSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { intro, outro, text, spinner, log, note } from '@clack/prompts'
import chalk from 'chalk'
import { execa } from 'execa'
import { findInstallDir, readConfig } from '../utils/config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Patch a single XML element value in-place */
function patchXml(content: string, tag: string, value: string): string {
  const re = new RegExp(`(<${tag}>)[^<]*(</\\s*${tag}>)`, 'g')
  return content.replace(re, `$1${value}$2`)
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

  // ── 2. Check sf CLI ────────────────────────────────────────────────────────
  const s = spinner()
  s.start('Checking Salesforce CLI…')
  try {
    await execa('sf', ['--version'], { all: true })
    s.stop('Salesforce CLI found')
  } catch {
    s.stop('Salesforce CLI (sf) not found')
    note(
      'Install the Salesforce CLI, then re-run this command:\n' +
      '  https://developer.salesforce.com/tools/salesforcecli\n\n' +
      'Or deploy manually from the sfdc-package directory:\n' +
      `  cd ${dir}/sfdc-package\n` +
      '  sf project deploy start --target-org <alias> \\\n' +
      '    --metadata ApexClass,ApexTrigger,CustomObject,NamedCredential,LightningComponentBundle,RemoteSiteSettings',
      'Manual deploy instructions'
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

  // ── 4. Authenticate (device flow — no browser required on this machine) ────
  log.info('Opening Salesforce login via device flow (no browser needed on this server)…')
  log.info('You will be given a URL and a code — open the URL on any device (phone/laptop) and enter the code.')
  try {
    await execa('sf', ['org', 'login', 'device', '--alias', alias as string], {
      stdio: 'inherit',
    })
    log.success('Authenticated')
  } catch (err) {
    log.error('Authentication failed: ' + String(err))
    process.exit(1)
  }

  // ── 5. Copy + patch sfdc-package ───────────────────────────────────────────
  s.start('Copying Salesforce package to install directory…')

  // Source: bundled inside the CLI dist (dist/sfdc-package)
  const bundledPkg = join(__dirname, '..', 'sfdc-package')
  const destPkg = join(dir ?? tmpdir(), 'lead-routing-sfdc-package')

  if (!existsSync(bundledPkg)) {
    s.stop('sfdc-package not found in CLI bundle')
    log.error(`Expected bundle at: ${bundledPkg}`)
    process.exit(1)
  }

  if (existsSync(destPkg)) rmSync(destPkg, { recursive: true, force: true })
  cpSync(bundledPkg, destPkg, { recursive: true })
  s.stop('Package copied')

  // ── 6. Patch Named Credential ──────────────────────────────────────────────
  const ncPath = join(destPkg, 'force-app', 'main', 'default', 'namedCredentials', 'RoutingEngine.namedCredential-meta.xml')
  if (existsSync(ncPath)) {
    const nc = patchXml(readFileSync(ncPath, 'utf8'), 'endpoint', engineUrl)
    writeFileSync(ncPath, nc, 'utf8')
    log.success(`Named Credential endpoint → ${engineUrl}`)
  }

  // ── 7. Patch Remote Site Settings ──────────────────────────────────────────
  const rssEnginePath = join(destPkg, 'force-app', 'main', 'default', 'remoteSiteSettings', 'LeadRouterEngine.remoteSite-meta.xml')
  if (existsSync(rssEnginePath)) {
    let rss = patchXml(readFileSync(rssEnginePath, 'utf8'), 'url', engineUrl)
    rss = patchXml(rss, 'description', 'Lead Router Engine endpoint')
    writeFileSync(rssEnginePath, rss, 'utf8')
    log.success(`Remote Site Setting LeadRouterEngine → ${engineUrl}`)
  }

  const rssAppPath = join(destPkg, 'force-app', 'main', 'default', 'remoteSiteSettings', 'LeadRouterApp.remoteSite-meta.xml')
  if (existsSync(rssAppPath)) {
    let rss = patchXml(readFileSync(rssAppPath, 'utf8'), 'url', appUrl)
    rss = patchXml(rss, 'description', 'Lead Router App URL')
    writeFileSync(rssAppPath, rss, 'utf8')
    log.success(`Remote Site Setting LeadRouterApp → ${appUrl}`)
  }

  // ── 8. Deploy package ──────────────────────────────────────────────────────
  s.start('Deploying Salesforce package (this may take ~2 min)…')
  try {
    await execa('sf', [
      'project', 'deploy', 'start',
      '--target-org', alias as string,
      '--source-dir', 'force-app',
    ], {
      cwd: destPkg,
      stdio: 'inherit',
    })
    s.stop('Package deployed')
  } catch (err) {
    s.stop('Deployment failed')
    log.error(String(err))
    log.info(`You can retry manually:\n  cd ${destPkg}\n  sf project deploy start --target-org ${alias as string} --source-dir force-app`)
    process.exit(1)
  }

  // ── 8b. Assign LeadRouterAdmin permission set so the app is visible ────────
  s.start('Assigning LeadRouterAdmin permission set to your user…')
  try {
    await execa('sf', [
      'org', 'assign', 'permset',
      '--name', 'LeadRouterAdmin',
      '--target-org', alias as string,
    ], { stdio: 'inherit' })
    s.stop('Permission set assigned — Lead Router Setup will appear in the App Launcher')
  } catch (err) {
    const msg = String(err)
    if (msg.includes('Duplicate PermissionSetAssignment')) {
      // Already assigned — this is fine; re-deploy updates the permset definition in-place
      s.stop('Permission set already assigned — Lead Router Setup will appear in the App Launcher')
    } else {
      s.stop('Permission set assignment failed (non-fatal)')
      log.warn(msg)
      log.info(
        'Grant yourself the "Lead Router Admin" permission set manually:\n' +
        '  Setup → Users → Permission Sets → Lead Router Admin → Manage Assignments'
      )
    }
  }

  // ── 9. Write org settings (App_Url__c + Engine_Endpoint__c) ────────────────
  // Routing_Settings__c is a Hierarchy Custom Setting — only one org-level
  // record can exist (unique SetupOwnerId). Query first; update if found, else create.
  s.start('Writing org settings to Routing_Settings__c…')
  try {
    let existingId: string | undefined
    try {
      const qr = await execa('sf', [
        'data', 'query',
        '--target-org', alias as string,
        '--query', 'SELECT Id FROM Routing_Settings__c LIMIT 1',
        '--json',
      ])
      const parsed = JSON.parse(qr.stdout)
      existingId = parsed?.result?.records?.[0]?.Id
    } catch {
      // query failure → treat as no record
    }

    if (existingId) {
      await execa('sf', [
        'data', 'update', 'record',
        '--target-org', alias as string,
        '--sobject', 'Routing_Settings__c',
        '--record-id', existingId,
        '--values', `App_Url__c='${appUrl}' Engine_Endpoint__c='${engineUrl}'`,
      ], { stdio: 'inherit' })
    } else {
      await execa('sf', [
        'data', 'create', 'record',
        '--target-org', alias as string,
        '--sobject', 'Routing_Settings__c',
        '--values', `App_Url__c='${appUrl}' Engine_Endpoint__c='${engineUrl}'`,
      ], { stdio: 'inherit' })
    }
    s.stop('Org settings written')
  } catch (err) {
    s.stop('Org settings write failed (non-fatal)')
    log.warn(String(err))
    log.info('You can set these manually in Salesforce → Custom Settings → Routing Settings → Manage')
  }

  // ── Done ────────────────────────────────────────────────────────────────────
  outro(
    chalk.green('✔  Salesforce package deployed!') +
    '\n\n' +
    '  Next steps:\n' +
    '  1. In Salesforce, open App Launcher → search "Lead Router Setup"\n' +
    '  2. Click "Connect to Lead Router" to authorise the OAuth connection\n' +
    '  3. Follow the 4-step wizard to activate triggers and sync field schema\n\n' +
    `  Your Lead Router dashboard: ${chalk.cyan(appUrl)}`
  )
}
