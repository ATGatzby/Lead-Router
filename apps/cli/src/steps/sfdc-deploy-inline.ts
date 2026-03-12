import { readFileSync, writeFileSync, existsSync, cpSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { spinner, log } from '@clack/prompts'
import { SalesforceApi, DuplicateError } from '../utils/sfdc-api.js'
import { zipSourcePackage } from '../utils/zip-source.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function patchXml(content: string, tag: string, value: string): string {
  const re = new RegExp(`(<${tag}>)[^<]*(</\\s*${tag}>)`, 'g')
  return content.replace(re, `$1${value}$2`)
}

export interface SfdcDeployParams {
  appUrl: string
  engineUrl: string
  orgAlias: string
  /** Where to copy the patched package — defaults to tmpdir */
  installDir?: string
  /** Webhook secret for HMAC validation — written to Routing_Settings__c.Webhook_Secret__c */
  webhookSecret?: string
}

/**
 * Core Salesforce deploy logic shared between `init` (inline) and the
 * standalone `sfdc deploy` command.
 *
 * Uses the Salesforce REST API directly — no `sf` CLI required.
 */
export async function sfdcDeployInline(params: SfdcDeployParams): Promise<void> {
  const { appUrl, engineUrl, installDir } = params
  const s = spinner()

  // ── 1. Web login via app bridge ────────────────────────────────────────────
  const { accessToken, instanceUrl } = await loginViaAppBridge(appUrl)
  const sf = new SalesforceApi(instanceUrl, accessToken)

  // ── 2. Copy + patch sfdc-package ───────────────────────────────────────────
  s.start('Copying Salesforce package…')

  // Published npm/npx: sfdc-package is inside dist/ (same dir as index.js)
  // Dev monorepo: sfdc-package is one level up from dist/
  const inDist = join(__dirname, 'sfdc-package')
  const nextToDist = join(__dirname, '..', 'sfdc-package')
  const bundledPkg = existsSync(inDist) ? inDist : nextToDist
  const destPkg = join(installDir ?? tmpdir(), 'lead-routing-sfdc-package')

  if (!existsSync(bundledPkg)) {
    s.stop('sfdc-package not found in CLI bundle')
    throw new Error(
      `Expected bundle at: ${inDist}\n` +
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

  // ── 3. Deploy package via REST API ─────────────────────────────────────────
  s.start('Deploying Salesforce package (this may take ~2 min)…')
  try {
    const zipBuffer = await zipSourcePackage(destPkg)
    const deployId = await sf.deployMetadata(zipBuffer)
    const result = await sf.waitForDeploy(deployId)

    if (!result.success) {
      const failures = result.details?.componentFailures ?? []
      const failureMsg = failures
        .map((f) => `  ${f.componentType}/${f.fullName}: ${f.problem}`)
        .join('\n')
      s.stop('Deployment failed')
      throw new Error(
        `Metadata deploy failed (${result.numberComponentErrors} error(s)):\n${failureMsg || result.errorMessage || 'Unknown error'}`
      )
    }

    s.stop(`Package deployed (${result.numberComponentsDeployed} components)`)
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Metadata deploy failed')) {
      throw err
    }
    s.stop('Deployment failed')
    throw new Error(
      `Metadata deploy failed: ${String(err)}\n\n` +
      `  The patched package is at: ${destPkg}\n` +
      `  You can retry with: sf project deploy start --source-dir force-app`
    )
  }

  // ── 4. Assign LeadRouterAdmin permission set ───────────────────────────────
  s.start('Assigning LeadRouterAdmin permission set…')
  try {
    // Look up the permission set ID
    const permSets = await sf.query<{ Id: string }>(
      "SELECT Id FROM PermissionSet WHERE Name = 'LeadRouterAdmin' LIMIT 1"
    )
    if (permSets.length === 0) {
      s.stop('LeadRouterAdmin permission set not found (non-fatal)')
      log.warn('The permission set may not have been included in the deploy.')
    } else {
      const userId = await sf.getCurrentUserId()
      try {
        await sf.create('PermissionSetAssignment', {
          AssigneeId: userId,
          PermissionSetId: permSets[0].Id,
        })
        s.stop('Permission set assigned — Lead Router Setup will appear in the App Launcher')
      } catch (err) {
        if (err instanceof DuplicateError) {
          s.stop('Permission set already assigned')
        } else {
          throw err
        }
      }
    }
  } catch (err) {
    if (!(err instanceof DuplicateError)) {
      s.stop('Permission set assignment failed (non-fatal)')
      log.warn(String(err))
      log.info(
        'Grant access manually:\n' +
        '  Salesforce Setup → Users → Permission Sets → Lead Router Admin → Manage Assignments'
      )
    }
  }

  // ── 5. Write Routing_Settings__c ──────────────────────────────────────────
  s.start('Writing org settings to Routing_Settings__c…')
  try {
    const existing = await sf.query<{ Id: string }>(
      'SELECT Id FROM Routing_Settings__c LIMIT 1'
    )

    const settingsData: Record<string, string> = {
      App_Url__c: appUrl,
      Engine_Endpoint__c: engineUrl,
    }
    if (params.webhookSecret) {
      settingsData.Webhook_Secret__c = params.webhookSecret
    }

    if (existing.length > 0) {
      await sf.update('Routing_Settings__c', existing[0].Id, settingsData)
    } else {
      await sf.create('Routing_Settings__c', settingsData)
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
 *
 * Returns { accessToken, instanceUrl } for direct REST API usage.
 */
async function loginViaAppBridge(
  rawAppUrl: string
): Promise<{ accessToken: string; instanceUrl: string }> {
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

  // Open browser (platform-agnostic, using child_process to avoid execa dep)
  const opener = process.platform === 'win32' ? 'start'
    : process.platform === 'darwin' ? 'open'
    : 'xdg-open'
  try {
    execSync(`${opener} "${authUrl}"`, { stdio: 'ignore' })
  } catch {
    // Silently ignore — URL is already printed above
  }

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

  return { accessToken, instanceUrl }
}
