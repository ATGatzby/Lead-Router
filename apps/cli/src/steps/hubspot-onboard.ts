/**
 * Full HubSpot onboarding flow run from the CLI after VPS deploy succeeds.
 *
 * Mirrors `sfdcOnboard` for HubSpot. After this step completes the user has:
 *   - HubSpot OAuth tokens stored in the web app (via the cli-auth bridge)
 *   - Contact / Company / Deal field schemas synced
 *   - onboardingDone flag flipped (best-effort)
 *
 * Idempotent — safe to re-run. The web app's HubSpot callback is responsible
 * for replacing existing tokens.
 */

import { exec } from 'node:child_process'
import { platform } from 'node:os'
import { isCancel, log, note, spinner, text } from '@clack/prompts'
import chalk from 'chalk'
import { syncHubspotFields, type FieldSyncResult } from '../utils/field-sync-client.js'

export interface HubspotOnboardParams {
  appUrl: string
  /** Bearer token for /api/integrations/hubspot/fields and /api/setup/*. */
  apiToken: string
}

export interface HubspotOnboardResult {
  authorized: boolean
  fieldsSynced: FieldSyncResult
  onboardingDone: boolean
}

function trim(url: string): string {
  return url.replace(/\/+$/, '')
}

function openBrowser(url: string): void {
  const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open'
  try {
    exec(`${cmd} ${JSON.stringify(url)}`)
  } catch {
    // Ignore — URL is also printed to the console.
  }
}

/**
 * Hit a CLI-auth bridge endpoint similar to the Salesforce one. We assume
 * Phase 1 of the agentic plan adds:
 *
 *   POST {appUrl}/api/cli-auth/hubspot/request → { sessionId, authUrl }
 *   GET  {appUrl}/api/cli-auth/hubspot/poll/{sessionId} →
 *           { status: 'pending' | 'ok' | 'expired' }
 *
 * If those endpoints don't exist yet the CLI prints the OAuth URL the user
 * should open manually and waits for confirmation — graceful fallback.
 */
async function bridgeAuthorize(appUrl: string): Promise<{ ok: boolean; error?: string }> {
  const s = spinner()

  // Try the dedicated CLI-auth bridge first.
  let sessionId: string | undefined
  let authUrl: string | undefined

  s.start('Starting HubSpot authentication…')
  try {
    const res = await fetch(`${trim(appUrl)}/api/cli-auth/hubspot/request`, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) {
      const data = (await res.json()) as { sessionId?: string; authUrl?: string }
      sessionId = data.sessionId
      authUrl = data.authUrl
    }
  } catch {
    // fall through to manual flow
  }

  if (!authUrl) {
    // Phase 1 hasn't shipped the bridge yet — fall back to direct login URL.
    authUrl = `${trim(appUrl)}/api/auth/hubspot/login?cli=true`
    s.stop('Using direct HubSpot login URL (CLI bridge not available)')
  } else {
    s.stop('HubSpot auth session started')
  }

  log.info(`Open this URL in your browser to authorize HubSpot:\n\n  ${authUrl}\n`)
  openBrowser(authUrl)

  // If the bridge gave us a sessionId, poll until OAuth completes. Otherwise
  // fall back to a confirm prompt — the user tells the CLI when they're done.
  if (sessionId) {
    s.start('Waiting for HubSpot authorization in browser…')
    const maxPolls = 150 // 5 minutes at 2s
    for (let i = 0; i < maxPolls; i++) {
      await new Promise<void>((r) => setTimeout(r, 2000))
      try {
        const pollRes = await fetch(
          `${trim(appUrl)}/api/cli-auth/hubspot/poll/${sessionId}`,
          { signal: AbortSignal.timeout(10_000) }
        )
        if (pollRes.status === 410) {
          s.stop('Auth session expired')
          return { ok: false, error: 'CLI auth session expired (5 min). Re-run the command.' }
        }
        if (!pollRes.ok) continue
        const data = (await pollRes.json()) as { status?: string }
        if (data.status === 'ok') {
          s.stop('HubSpot authorized')
          return { ok: true }
        }
      } catch {
        // Network hiccup — keep polling
      }
    }
    s.stop('Timed out')
    return {
      ok: false,
      error: 'Timed out waiting for HubSpot authorization (5 minutes).',
    }
  }

  // Manual fallback — wait for user confirmation.
  const ack = await text({
    message: 'Press Enter once you have completed the HubSpot OAuth flow…',
    defaultValue: '',
  })
  if (isCancel(ack)) {
    return { ok: false, error: 'cancelled by user' }
  }
  return { ok: true }
}

/** Mark onboarding complete via /api/setup/onboarding-done (HubSpot variant). */
async function markOnboardingDone(
  appUrl: string,
  apiToken: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${trim(appUrl)}/api/setup/onboarding-done`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ crm: 'hubspot' }),
      signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) return { ok: true }
    const text = await res.text().catch(() => '')
    return { ok: false, error: `HTTP ${res.status} ${text || res.statusText}` }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Run the full HubSpot onboarding flow from the CLI.
 */
export async function hubspotOnboard(
  params: HubspotOnboardParams
): Promise<HubspotOnboardResult> {
  const { appUrl, apiToken } = params

  const result: HubspotOnboardResult = {
    authorized: false,
    fieldsSynced: { ok: false, error: 'not run' },
    onboardingDone: false,
  }

  note(
    'HubSpot onboarding will:\n' +
      '  1. Open the OAuth consent screen in your browser\n' +
      '  2. Sync Contact / Company / Deal fields\n' +
      '  3. Mark onboarding complete',
    'HubSpot Onboarding'
  )

  // ── 1. OAuth ──────────────────────────────────────────────────────────────
  const auth = await bridgeAuthorize(appUrl)
  if (!auth.ok) {
    log.warn(
      `HubSpot authorization not completed: ${auth.error ?? 'unknown error'}.\n` +
        `You can finish this manually at ${appUrl}/integrations/hubspot.`
    )
    return result
  }
  result.authorized = true
  log.success('HubSpot authorized')

  // ── 2. Field sync ─────────────────────────────────────────────────────────
  const s = spinner()
  s.start('Syncing HubSpot fields (Contact + Company + Deal)…')
  const sync = await syncHubspotFields(appUrl, { apiToken })
  result.fieldsSynced = sync

  if (sync.skipped) {
    s.stop('Field sync skipped (license tier)')
  } else if (sync.ok) {
    s.stop(`HubSpot fields synced (${sync.synced ?? 0} total)`)
  } else {
    s.stop('Field sync failed')
    log.warn(sync.error ?? 'unknown error')
  }

  // ── 3. Mark onboarding done ───────────────────────────────────────────────
  const s2 = spinner()
  s2.start('Marking onboarding complete…')
  const done = await markOnboardingDone(appUrl, apiToken)
  if (done.ok) {
    s2.stop('Onboarding complete')
    result.onboardingDone = true
  } else {
    s2.stop('Could not mark onboarding done')
    log.warn(
      `Failed to call /api/setup/onboarding-done: ${done.error ?? 'unknown'}.\n` +
        `You can complete this manually from ${chalk.cyan(`${appUrl}/integrations/hubspot`)}.`
    )
  }

  return result
}
