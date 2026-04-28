/**
 * Typed wrapper around `/api/fields/sync` and `/api/integrations/hubspot/fields`.
 *
 * The CLI needs to authenticate to these endpoints WITHOUT a browser session —
 * we send a Bearer token (the customer's API token) and, for Salesforce,
 * optionally an `X-Sfdc-Org-Id` header so the route can identify the org.
 *
 * The endpoints currently in production may not yet accept Bearer tokens
 * (Phase 1 of the agentic-onboarding plan). This client is defensive:
 *   - 401 surfaces clearly: "auth not deployed yet"
 *   - 402 is treated as a license-tier skip (returns `{ skipped: true }`)
 *   - other errors throw with the response body
 */

export type SfdcObjectType = 'LEAD' | 'CONTACT' | 'ACCOUNT' | 'USER'

export interface FieldSyncResult {
  /** True when the endpoint was reached and the sync completed. */
  ok: boolean
  /** Number of fields synced (when `ok`). */
  synced?: number
  /** Set when the call was skipped due to license tier (HTTP 402). */
  skipped?: boolean
  /** Error message — set when `ok=false` and `skipped` is unset. */
  error?: string
  /** Raw HTTP status, for debugging/logging. */
  status?: number
}

interface FieldSyncOpts {
  /** Bearer token for the web app — typically the customer's API token. */
  apiToken: string
  /** SFDC org id — sent as `X-Sfdc-Org-Id` for backwards-compat with the
   *  current /api/fields/sync implementation. */
  sfdcOrgId?: string
  /** Optional fetch implementation override (used in tests). */
  fetchImpl?: typeof fetch
  /** Per-request timeout in ms. Defaults to 60s — describeSObject is slow. */
  timeoutMs?: number
}

function trim(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * Sync field schema for a single Salesforce object.
 *
 * Returns `{ ok: true, synced: N }` on success,
 *         `{ ok: true, skipped: true }` on 402 (license-tier blocked),
 *         `{ ok: false, error }` otherwise.
 *
 * NEVER throws for "expected" failures (402, 401, 4xx) — caller decides
 * whether to abort the wider onboarding flow.
 */
export async function syncFields(
  appUrl: string,
  objectType: SfdcObjectType,
  opts: FieldSyncOpts
): Promise<FieldSyncResult> {
  const f = opts.fetchImpl ?? fetch
  const url = `${trim(appUrl)}/api/fields/sync?object=${objectType}`

  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.apiToken}`,
    'Content-Type': 'application/json',
  }
  if (opts.sfdcOrgId) headers['X-Sfdc-Org-Id'] = opts.sfdcOrgId

  let res: Response
  try {
    res = await f(url, {
      method: 'POST',
      headers,
      body: '{}',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    })
  } catch (err) {
    return {
      ok: false,
      error: `Network error contacting ${url}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  // License-tier gate — Free tier blocks CONTACT/ACCOUNT
  if (res.status === 402) {
    return { ok: true, skipped: true, status: 402 }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return {
      ok: false,
      status: res.status,
      error:
        res.status === 401
          ? `Bearer auth rejected by ${url} (HTTP 401). The web app may not yet support Bearer tokens on /api/fields/sync — verify Phase 1 deploy.`
          : `Field sync failed (HTTP ${res.status}): ${text || res.statusText}`,
    }
  }

  const data = (await res.json().catch(() => ({}))) as {
    synced?: number
    objectType?: string
  }
  return { ok: true, synced: data.synced ?? 0, status: 200 }
}

/**
 * HubSpot equivalent — single endpoint syncs Contact + Company + Deal in one
 * call.
 */
export async function syncHubspotFields(
  appUrl: string,
  opts: Pick<FieldSyncOpts, 'apiToken' | 'fetchImpl' | 'timeoutMs'>
): Promise<FieldSyncResult> {
  const f = opts.fetchImpl ?? fetch
  const url = `${trim(appUrl)}/api/integrations/hubspot/fields`

  let res: Response
  try {
    res = await f(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    })
  } catch (err) {
    return {
      ok: false,
      error: `Network error contacting ${url}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  if (res.status === 402) return { ok: true, skipped: true, status: 402 }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return {
      ok: false,
      status: res.status,
      error:
        res.status === 401
          ? `Bearer auth rejected by ${url} (HTTP 401). The web app may not yet support Bearer tokens — verify Phase 1 deploy.`
          : `HubSpot field sync failed (HTTP ${res.status}): ${text || res.statusText}`,
    }
  }

  const data = (await res.json().catch(() => ({}))) as { total?: number }
  return { ok: true, synced: data.total ?? 0, status: 200 }
}
