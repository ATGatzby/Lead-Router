import { text, password, note, cancel, isCancel } from '@clack/prompts'
import { generateSecret } from '../utils/crypto.js'

export type CrmType = 'salesforce' | 'hubspot'

export interface CollectedConfig {
  appUrl: string
  engineUrl: string
  /** Base domain (e.g. acme.com) — all subdomains derived from this */
  baseDomain: string
  /** Langfuse evals dashboard URL (derived from baseDomain) */
  langfuseUrl: string
  /** MCP HTTP server URL (derived from baseDomain) */
  mcpUrl: string
  crmType: CrmType
  managedDb: boolean
  databaseUrl: string
  dbPassword: string
  managedRedis: boolean
  redisUrl: string
  redisPassword: string
  adminEmail: string
  adminPassword: string
  /** Always empty string — configure Resend post-install via config update */
  resendApiKey: string
  /** Always empty string — configure post-install */
  feedbackToEmail: string
  sessionSecret: string
  engineWebhookSecret: string
  internalApiKey: string
  /** HubSpot App ID — only set when crmType is 'hubspot' */
  hubspotAppId?: string
  /** HubSpot Client ID — only set when crmType is 'hubspot' */
  hubspotClientId?: string
  /** HubSpot Client Secret — only set when crmType is 'hubspot' */
  hubspotClientSecret?: string
}

export interface ConfigCollectOptions {
  /** External PostgreSQL URL — skips managed Docker container */
  externalDb?: string
  /** External Redis URL — skips managed Docker container */
  externalRedis?: string
  /** CRM type selected earlier in the wizard */
  crmType?: CrmType
}

function bail(value: unknown): never {
  if (isCancel(value)) {
    cancel('Setup cancelled.')
    process.exit(0)
  }
  throw new Error('Unexpected cancel')
}

export async function collectConfig(opts: ConfigCollectOptions = {}, authEmail?: string, authPassword?: string): Promise<CollectedConfig> {
  const crmType = opts.crmType ?? 'salesforce'

  note(
    'You will need:\n' +
      '  • A domain with wildcard DNS (*.acme.com) pointing to your server',
    'Before you begin'
  )

  // ── Base Domain ────────────────────────────────────────────────────────────
  const domain = await text({
    message: 'Your domain (we\'ll create app/api/evals/mcp subdomains):',
    placeholder: 'acme.com',
    validate: (v) => {
      if (!v?.trim()) return 'Domain is required'
      // Strip protocol if pasted
      const clean = v.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
      if (!clean.includes('.')) return 'Enter a valid domain (e.g. acme.com)'
    },
  })
  if (isCancel(domain)) bail(domain)

  const baseDomain = (domain as string).trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const appUrl = `https://app.${baseDomain}`
  const engineUrl = `https://api.${baseDomain}`
  const langfuseUrl = `https://evals.${baseDomain}`
  const mcpUrl = `https://mcp.${baseDomain}`

  note(
    [
      `App:     ${appUrl}`,
      `Engine:  ${engineUrl}`,
      `Evals:   ${langfuseUrl}`,
      `MCP:     ${mcpUrl}`,
      '',
      `Add this DNS record: *.${baseDomain} -> A -> <your server IP>`,
    ].join('\n'),
    'URLs'
  )

  // ── Database ───────────────────────────────────────────────────────────────
  // Default: managed Docker container. Override with --external-db <url>.
  const dbPassword = generateSecret(16)
  const managedDb = !opts.externalDb
  const databaseUrl =
    opts.externalDb ?? `postgresql://leadrouting:${dbPassword}@postgres:5432/leadrouting`

  // ── Redis ──────────────────────────────────────────────────────────────────
  // Default: managed Docker container with password auth. Override with --external-redis <url>.
  const redisPassword = generateSecret(16)
  const managedRedis = !opts.externalRedis
  const redisUrl = opts.externalRedis ?? `redis://:${redisPassword}@redis:6379`

  // ── Admin Account ──────────────────────────────────────────────────────────
  let adminEmail: string | symbol
  if (authEmail) {
    note(`Using ${authEmail} as admin email`, 'Admin Account')
    adminEmail = authEmail
  } else {
    note('This creates the first admin user for the web app.', 'Admin Account')

    adminEmail = await text({
      message: 'Admin email address',
      placeholder: 'admin@acme.com',
      validate: (v) => {
        if (!v) return 'Required'
        if (!v.includes('@')) return 'Must be a valid email'
      },
    })
    if (isCancel(adminEmail)) bail(adminEmail)
  }

  let adminPassword: string | symbol
  if (authPassword) {
    adminPassword = authPassword
  } else {
    adminPassword = await password({
      message: 'Admin password (min 8 characters)',
      validate: (v) => {
        if (!v) return 'Required'
        if (v.length < 8) return 'Must be at least 8 characters'
      },
    })
    if (isCancel(adminPassword)) bail(adminPassword)
  }

  // ── Auto-generated secrets ─────────────────────────────────────────────────
  const sessionSecret = generateSecret(32)
  const engineWebhookSecret = generateSecret(32)
  const internalApiKey = generateSecret(32)

  // HubSpot credentials are configured post-install via web app Integrations page
  const hubspotAppId: string | undefined = undefined
  const hubspotClientId: string | undefined = undefined
  const hubspotClientSecret: string | undefined = undefined

  return {
    appUrl,
    engineUrl,
    baseDomain,
    langfuseUrl,
    mcpUrl,
    crmType,
    managedDb,
    databaseUrl,
    dbPassword: managedDb ? dbPassword : '',
    managedRedis,
    redisUrl,
    redisPassword: managedRedis ? redisPassword : '',
    adminEmail: adminEmail as string,
    adminPassword: adminPassword as string,
    resendApiKey: '',
    feedbackToEmail: '',
    sessionSecret,
    engineWebhookSecret,
    internalApiKey,
    hubspotAppId,
    hubspotClientId,
    hubspotClientSecret,
  }
}
