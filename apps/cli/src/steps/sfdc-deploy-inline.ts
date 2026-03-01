import { readFileSync, writeFileSync, existsSync, cpSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spinner, log } from '@clack/prompts'
import { execa } from 'execa'

const __dirname = dirname(fileURLToPath(import.meta.url))

function patchXml(content: string, tag: string, value: string): string {
  const re = new RegExp(`(<${tag}>)[^<]*(</\\s*${tag}>)`, 'g')
  return content.replace(re, `$1${value}$2`)
}

export interface SfdcDeployParams {
  appUrl: string
  engineUrl: string
  orgAlias: string
  /** Connected App client ID — no longer used for login (web app bridge handles auth),
   *  kept in the interface for backwards compat with sfdc.ts which reads it from config */
  sfdcClientId: string
  /** Salesforce login URL (https://login.salesforce.com or https://test.salesforce.com) */
  sfdcLoginUrl: string
  /** Where to copy the patched package — defaults to tmpdir */
  installDir?: string
}

/**
 * Core Salesforce deploy logic shared between `init` (inline) and the
 * standalone `sfdc deploy` command.
 *
 * Assumes `sf` CLI is already verified by the caller (either prerequisites
 * check in init, or the explicit check in sfdc.ts).
 */
export async function sfdcDeployInline(params: SfdcDeployParams): Promise<void> {
  const { appUrl, engineUrl, orgAlias, installDir } = params
  const s = spinner()

  // ── 1. Web login via app bridge ────────────────────────────────────────────
  // Check if already authenticated to this org alias — skip browser login if so.
  const { code: authCheck } = await execa(
    'sf', ['org', 'display', '--target-org', orgAlias, '--json'],
    { reject: false }
  )
  const alreadyAuthed = authCheck === 0

  if (alreadyAuthed) {
    log.success('Using existing Salesforce authentication')
  } else {
    await loginViaAppBridge(appUrl, orgAlias)
  }

  // ── 2. Copy + patch sfdc-package ───────────────────────────────────────────
  s.start('Copying Salesforce package…')

  const bundledPkg = join(__dirname, '..', 'sfdc-package')
  const destPkg = join(installDir ?? tmpdir(), 'lead-routing-sfdc-package')

  if (!existsSync(bundledPkg)) {
    s.stop('sfdc-package not found in CLI bundle')
    throw new Error(
      `Expected bundle at: ${bundledPkg}\n` +
      'The CLI may need to be reinstalled: npm i -g @lead-routing/cli'
    )
  }

  if (existsSync(destPkg)) rmSync(destPkg, { recursive: true, force: true })
  cpSync(bundledPkg, destPkg, { recursive: true })
  s.stop('Package copied')

  // Patch Named Credential
  const ncPath = join(
    destPkg,
    'force-app', 'main', 'default', 'namedCredentials',
    'RoutingEngine.namedCredential-meta.xml'
  )
  if (existsSync(ncPath)) {
    const nc = patchXml(readFileSync(ncPath, 'utf8'), 'endpoint', engineUrl)
    writeFileSync(ncPath, nc, 'utf8')
  }

  // Patch Remote Site Settings
  const rssEnginePath = join(
    destPkg,
    'force-app', 'main', 'default', 'remoteSiteSettings',
    'LeadRouterEngine.remoteSite-meta.xml'
  )
  if (existsSync(rssEnginePath)) {
    let rss = patchXml(readFileSync(rssEnginePath, 'utf8'), 'url', engineUrl)
    rss = patchXml(rss, 'description', 'Lead Router Engine endpoint')
    writeFileSync(rssEnginePath, rss, 'utf8')
  }

  const rssAppPath = join(
    destPkg,
    'force-app', 'main', 'default', 'remoteSiteSettings',
    'LeadRouterApp.remoteSite-meta.xml'
  )
  if (existsSync(rssAppPath)) {
    let rss = patchXml(readFileSync(rssAppPath, 'utf8'), 'url', appUrl)
    rss = patchXml(rss, 'description', 'Lead Router App URL')
    writeFileSync(rssAppPath, rss, 'utf8')
  }

  log.success('Remote Site Settings patched')

  // ── 3. Deploy package ──────────────────────────────────────────────────────
  s.start('Deploying Salesforce package (this may take ~2 min)…')
  try {
    await execa(
      'sf',
      ['project', 'deploy', 'start', '--target-org', orgAlias, '--source-dir', 'force-app'],
      { cwd: destPkg, stdio: 'inherit' }
    )
    s.stop('Package deployed')
  } catch (err) {
    s.stop('Deployment failed')
    throw new Error(
      `sf project deploy failed: ${String(err)}\n\n` +
      `  Retry manually:\n` +
      `  cd ${destPkg}\n` +
      `  sf project deploy start --target-org ${orgAlias} --source-dir force-app`
    )
  }

  // ── 4. Assign LeadRouterAdmin permission set ───────────────────────────────
  s.start('Assigning LeadRouterAdmin permission set…')
  try {
    await execa(
      'sf',
      ['org', 'assign', 'permset', '--name', 'LeadRouterAdmin', '--target-org', orgAlias],
      { stdio: 'inherit' }
    )
    s.stop('Permission set assigned — Lead Router Setup will appear in the App Launcher')
  } catch (err) {
    const msg = String(err)
    if (msg.includes('Duplicate PermissionSetAssignment')) {
      s.stop('Permission set already assigned')
    } else {
      s.stop('Permission set assignment failed (non-fatal)')
      log.warn(msg)
      log.info(
        'Grant access manually:\n' +
        '  Salesforce Setup → Users → Permission Sets → Lead Router Admin → Manage Assignments'
      )
    }
  }

  // ── 5. Write Routing_Settings__c ──────────────────────────────────────────
  s.start('Writing org settings to Routing_Settings__c…')
  try {
    let existingId: string | undefined
    try {
      const qr = await execa('sf', [
        'data', 'query',
        '--target-org', orgAlias,
        '--query', 'SELECT Id FROM Routing_Settings__c LIMIT 1',
        '--json',
      ])
      const parsed = JSON.parse(qr.stdout)
      existingId = parsed?.result?.records?.[0]?.Id
    } catch {
      // no record yet — will create below
    }

    if (existingId) {
      await execa('sf', [
        'data', 'update', 'record',
        '--target-org', orgAlias,
        '--sobject', 'Routing_Settings__c',
        '--record-id', existingId,
        '--values', `App_Url__c='${appUrl}' Engine_Endpoint__c='${engineUrl}'`,
      ], { stdio: 'inherit' })
    } else {
      await execa('sf', [
        'data', 'create', 'record',
        '--target-org', orgAlias,
        '--sobject', 'Routing_Settings__c',
        '--values', `App_Url__c='${appUrl}' Engine_Endpoint__c='${engineUrl}'`,
      ], { stdio: 'inherit' })
    }
    s.stop('Org settings written')
  } catch (err) {
    s.stop('Org settings write failed (non-fatal)')
    log.warn(String(err))
    log.info('Set manually: Salesforce → Custom Settings → Routing Settings → Manage')
  }
}

/**
 * Authenticate with Salesforce via the web app OAuth bridge.
 *
 * Flow:
 *  1. POST {appUrl}/api/cli-auth/request → get { sessionId, authUrl }
 *  2. Open authUrl in browser (Salesforce login → redirects to {appUrl}/api/auth/callback)
 *  3. Web app exchanges code, stores token under sessionId
 *  4. Poll {appUrl}/api/cli-auth/poll/{sessionId} until token arrives
 *  5. Store token in sf CLI via `sf org login access-token`
 *
 * Uses only {appUrl}/api/auth/callback as redirect_uri — no extra URLs needed
 * in the Connected App beyond the one already registered for the web app login.
 */
async function loginViaAppBridge(rawAppUrl: string, orgAlias: string): Promise<void> {
  // Strip trailing slash so URLs like "https://example.com/" don't produce double-slashes
  const appUrl = rawAppUrl.replace(/\/+$/, '')
  const s = spinner()
  s.start('Starting Salesforce authentication via your Lead Router app…')

  let sessionId: string
  let authUrl: string

  try {
    const res = await fetch(`${appUrl}/api/cli-auth/request`, { method: 'POST' })
    if (!res.ok) {
      s.stop('Failed to start auth session')
      throw new Error(
        `Could not reach ${appUrl}/api/cli-auth/request (HTTP ${res.status}).\n` +
        'Make sure the web app is running and accessible.'
      )
    }
    const data = await res.json() as { sessionId: string; authUrl: string }
    sessionId = data.sessionId
    authUrl = data.authUrl
  } catch (err) {
    s.stop('Could not reach Lead Router app')
    throw new Error(
      `Failed to connect to ${appUrl}: ${String(err)}\n` +
      'Ensure the app is running and the URL is correct.'
    )
  }

  s.stop('Auth session started')
  log.info(`Open this URL in your browser to authenticate with Salesforce:\n\n  ${authUrl}\n`)
  log.info('If Chrome shows a "Dangerous site" warning with no proceed option, paste the URL into Safari or Firefox.')

  // Open browser (platform-agnostic)
  const opener = process.platform === 'win32' ? 'start'
    : process.platform === 'darwin' ? 'open'
    : 'xdg-open'
  await execa(opener, [authUrl], { reject: false }).catch(() => {
    // Silently ignore — URL is already printed above
  })

  // Poll until token arrives (up to 5 minutes, every 2 s)
  s.start('Waiting for Salesforce authentication in browser…')
  const maxPolls = 150
  let accessToken: string | undefined
  let instanceUrl: string | undefined

  for (let i = 0; i < maxPolls; i++) {
    await new Promise<void>((r) => setTimeout(r, 2000))
    try {
      const pollRes = await fetch(`${appUrl}/api/cli-auth/poll/${sessionId}`)
      if (pollRes.status === 410) {
        s.stop('Auth session expired')
        throw new Error('CLI auth session expired. Please re-run the command.')
      }
      const data = await pollRes.json() as {
        status: 'pending' | 'ok' | 'expired'
        accessToken?: string
        instanceUrl?: string
      }
      if (data.status === 'ok') {
        accessToken = data.accessToken
        instanceUrl = data.instanceUrl
        break
      }
    } catch (err) {
      // Network hiccup — keep polling
      if (String(err).includes('session expired')) throw err
    }
  }

  if (!accessToken || !instanceUrl) {
    s.stop('Timed out')
    throw new Error(
      'Timed out waiting for Salesforce authentication (5 minutes).\n' +
      'Please re-run the command and complete login within 5 minutes.'
    )
  }

  s.stop('Authenticated with Salesforce')

  // Store credentials in sf CLI via access-token login
  // sf org login access-token reads the token from stdin (masked prompt)
  try {
    await execa(
      'sf',
      ['org', 'login', 'access-token', '--instance-url', instanceUrl, '--alias', orgAlias, '--no-prompt'],
      { input: accessToken + '\n' }
    )
    log.success(`Salesforce org saved as "${orgAlias}"`)
  } catch (err) {
    // Non-fatal — subsequent sf commands can use SF_ACCESS_TOKEN env var instead
    log.warn(`Could not store sf CLI credentials: ${String(err)}`)
    log.info('Re-authenticate manually if deploy commands fail: sf org login web')
  }
}
