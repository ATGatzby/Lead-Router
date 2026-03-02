import { text, password, note, cancel, isCancel } from '@clack/prompts'
import { generateSecret } from '../utils/crypto.js'

export interface CollectedConfig {
  appUrl: string
  engineUrl: string
  sfdcClientId: string
  sfdcClientSecret: string
  sfdcLoginUrl: string
  managedDb: boolean
  databaseUrl: string
  dbPassword: string
  managedRedis: boolean
  redisUrl: string
  adminEmail: string
  adminPassword: string
  /** Always empty string — configure Resend post-install via config update */
  resendApiKey: string
  /** Always empty string — configure post-install */
  feedbackToEmail: string
  sessionSecret: string
  engineWebhookSecret: string
  adminSecret: string
}

export interface ConfigCollectOptions {
  /** Use Salesforce sandbox (test.salesforce.com) instead of production */
  sandbox?: boolean
  /** External PostgreSQL URL — skips managed Docker container */
  externalDb?: string
  /** External Redis URL — skips managed Docker container */
  externalRedis?: string
}

function bail(value: unknown): never {
  if (isCancel(value)) {
    cancel('Setup cancelled.')
    process.exit(0)
  }
  throw new Error('Unexpected cancel')
}

export async function collectConfig(opts: ConfigCollectOptions = {}): Promise<CollectedConfig> {
  note(
    'You will need:\n' +
      '  • A Salesforce Connected App (Client ID + Secret) — instructions below\n' +
      '  • Public HTTPS URLs for the web app and routing engine',
    'Before you begin'
  )

  // ── App URL ────────────────────────────────────────────────────────────────
  const appUrl = await text({
    message: 'App URL (public URL where the web app will be accessible)',
    placeholder: 'https://routing.acme.com',
    validate: (v) => {
      if (!v) return 'Required'
      try {
        const u = new URL(v)
        if (u.protocol !== 'https:') return 'Must be an HTTPS URL (required for Salesforce OAuth)'
      } catch {
        return 'Must be a valid URL (e.g. https://routing.acme.com)'
      }
    },
  })
  if (isCancel(appUrl)) bail(appUrl)

  // ── Engine URL ─────────────────────────────────────────────────────────────
  const engineUrl = await text({
    message: 'Engine URL (public URL Salesforce will use to route leads)',
    placeholder: 'https://engine.acme.com  or  https://acme.com:3001',
    validate: (v) => {
      if (!v) return 'Required'
      try {
        const u = new URL(v)
        if (u.protocol !== 'https:') return 'Must be an HTTPS URL (Salesforce requires HTTPS)'
      } catch {
        return 'Must be a valid URL (e.g. https://engine.acme.com)'
      }
    },
  })
  if (isCancel(engineUrl)) bail(engineUrl)

  // ── Salesforce Connected App ────────────────────────────────────────────────
  // Callback URL must match SFDC_REDIRECT_URI in .env.web exactly.
  const callbackUrl = `${(appUrl as string).trim().replace(/\/+$/, '')}/api/auth/sfdc/callback`
  note(
    "You need a Salesforce Connected App. If you haven't created one yet:\n" +
      '\n' +
      '  1. Go to Salesforce Setup → App Manager → New Connected App\n' +
      '  2. Connected App Name: Lead Routing\n' +
      '  3. Check "Enable OAuth Settings"\n' +
      `  4. Callback URL (copy exactly — must match):\n` +
      `       ${callbackUrl}\n` +
      '  5. Selected Scopes: api  •  refresh_token, offline_access\n' +
      '  6. Check "Require Secret for Web Server Flow"\n' +
      '  7. Save — wait ~2 min, then click "Manage Consumer Details"\n' +
      '  8. Copy the Consumer Key (Client ID) and Consumer Secret below',
    'Salesforce Connected App setup'
  )

  const sfdcClientId = await text({
    message: 'Consumer Key (labelled "Client ID" in newer orgs)',
    placeholder: '3MVG9...',
    validate: (v) => (!v ? 'Required' : undefined),
  })
  if (isCancel(sfdcClientId)) bail(sfdcClientId)

  const sfdcClientSecret = await password({
    message: 'Consumer Secret (labelled "Client Secret" in newer orgs)',
    validate: (v) => (!v ? 'Required' : undefined),
  })
  if (isCancel(sfdcClientSecret)) bail(sfdcClientSecret)

  // SFDC login URL: production by default, sandbox via --sandbox flag
  const sfdcLoginUrl = opts.sandbox
    ? 'https://test.salesforce.com'
    : 'https://login.salesforce.com'

  // ── Database ───────────────────────────────────────────────────────────────
  // Default: managed Docker container. Override with --external-db <url>.
  const dbPassword = generateSecret(16)
  const managedDb = !opts.externalDb
  const databaseUrl =
    opts.externalDb ?? `postgresql://leadrouting:${dbPassword}@postgres:5432/leadrouting`

  // ── Redis ──────────────────────────────────────────────────────────────────
  // Default: managed Docker container. Override with --external-redis <url>.
  const managedRedis = !opts.externalRedis
  const redisUrl = opts.externalRedis ?? 'redis://redis:6379'

  // ── Admin Account ──────────────────────────────────────────────────────────
  note('This creates the first admin user for the web app.', 'Admin Account')

  const adminEmail = await text({
    message: 'Admin email address',
    placeholder: 'admin@acme.com',
    validate: (v) => {
      if (!v) return 'Required'
      if (!v.includes('@')) return 'Must be a valid email'
    },
  })
  if (isCancel(adminEmail)) bail(adminEmail)

  const adminPassword = await password({
    message: 'Admin password (min 8 characters)',
    validate: (v) => {
      if (!v) return 'Required'
      if (v.length < 8) return 'Must be at least 8 characters'
    },
  })
  if (isCancel(adminPassword)) bail(adminPassword)

  // ── Auto-generated secrets ─────────────────────────────────────────────────
  const sessionSecret = generateSecret(32)
  const engineWebhookSecret = generateSecret(32)
  const adminSecret = generateSecret(16)

  return {
    appUrl: (appUrl as string).trim().replace(/\/+$/, ''),
    engineUrl: (engineUrl as string).trim().replace(/\/+$/, ''),
    sfdcClientId: (sfdcClientId as string).trim(),
    sfdcClientSecret: (sfdcClientSecret as string).trim(),
    sfdcLoginUrl,
    managedDb,
    databaseUrl,
    dbPassword: managedDb ? dbPassword : '',
    managedRedis,
    redisUrl,
    adminEmail: adminEmail as string,
    adminPassword: adminPassword as string,
    resendApiKey: '',
    feedbackToEmail: '',
    sessionSecret,
    engineWebhookSecret,
    adminSecret,
  }
}
