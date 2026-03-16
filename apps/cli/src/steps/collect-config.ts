import { text, password, note, cancel, isCancel } from '@clack/prompts'
import { generateSecret } from '../utils/crypto.js'

export interface CollectedConfig {
  appUrl: string
  engineUrl: string
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
}

export interface ConfigCollectOptions {
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
  const internalApiKey = generateSecret(32)

  return {
    appUrl: (appUrl as string).trim().replace(/\/+$/, ''),
    engineUrl: (engineUrl as string).trim().replace(/\/+$/, ''),
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
  }
}
