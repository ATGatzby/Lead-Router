import {
  group,
  text,
  password,
  select,
  confirm,
  note,
  cancel,
  isCancel,
} from '@clack/prompts'
import { generateSecret } from '../utils/crypto.js'

export interface CollectedConfig {
  appUrl: string
  engineUrl: string
  sfdcClientId: string
  sfdcClientSecret: string
  sfdcLoginUrl: string
  orgAlias: string
  managedDb: boolean
  databaseUrl: string
  dbPassword: string
  managedRedis: boolean
  redisUrl: string
  adminEmail: string
  adminPassword: string
  resendApiKey: string
  feedbackToEmail: string
  sessionSecret: string
  engineWebhookSecret: string
  adminSecret: string
}

function bail(value: unknown): never {
  if (isCancel(value)) {
    cancel('Setup cancelled.')
    process.exit(0)
  }
  throw new Error('Unexpected cancel')
}

export async function collectConfig(): Promise<CollectedConfig> {
  note(
    'You will need:\n' +
      '  • A Salesforce Connected App (Client ID + Secret) — instructions below\n' +
      '  • A public URL or localhost for the app\n' +
      '  • PostgreSQL + Redis (or let Docker manage them)',
    'Before you begin'
  )

  // ── App ────────────────────────────────────────────────────────────────────
  const appUrl = await text({
    message: 'App URL (public URL where the web app will be accessible)',
    placeholder: 'https://routing.acme.com',
    validate: (v) => {
      if (!v) return 'Required'
      try {
        new URL(v)
      } catch {
        return 'Must be a valid URL (e.g. https://routing.acme.com)'
      }
    },
  })
  if (isCancel(appUrl)) bail(appUrl)

  // ── Engine URL ─────────────────────────────────────────────────────────────
  const engineUrl = await text({
    message: 'Engine URL (public URL Salesforce will use to route leads)',
    placeholder: 'https://engine.acme.com',
    hint: 'Subdomain: https://engine.acme.com  •  Same domain + port: https://acme.com:3001',
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

  // ── Salesforce ─────────────────────────────────────────────────────────────
  const callbackUrl = `${appUrl as string}/api/auth/callback`
  note(
    'You need a Salesforce Connected App. If you haven\'t created one yet:\n' +
      '\n' +
      '  1. Go to Salesforce Setup → App Manager → New Connected App\n' +
      '  2. Connected App Name: Lead Routing\n' +
      '  3. Check "Enable OAuth Settings"\n' +
      `  4. Callback URL:\n` +
      `       ${callbackUrl}\n` +
      '  5. Selected Scopes: api  •  refresh_token, offline_access  •  openid\n' +
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

  const sfdcLoginUrlChoice = await select({
    message: 'Salesforce environment',
    options: [
      { value: 'https://login.salesforce.com', label: 'Production / Developer org' },
      { value: 'https://test.salesforce.com', label: 'Sandbox' },
    ],
  })
  if (isCancel(sfdcLoginUrlChoice)) bail(sfdcLoginUrlChoice)
  const sfdcLoginUrl = sfdcLoginUrlChoice as string

  const orgAlias = await text({
    message: 'Salesforce org alias (used by the sf CLI to identify this org)',
    placeholder: 'lead-routing',
    initialValue: 'lead-routing',
    validate: (v) => (!v ? 'Required' : undefined),
  })
  if (isCancel(orgAlias)) bail(orgAlias)

  // ── Database ───────────────────────────────────────────────────────────────
  const managedDb = await confirm({
    message: 'Manage PostgreSQL with Docker? (recommended — choose No to provide your own URL)',
    initialValue: true,
  })
  if (isCancel(managedDb)) bail(managedDb)

  let databaseUrl = ''
  let dbPassword = generateSecret(16)

  if (managedDb) {
    databaseUrl = 'postgresql://leadrouting:' + dbPassword + '@postgres:5432/leadrouting'
  } else {
    const url = await text({
      message: 'PostgreSQL connection URL',
      placeholder: 'postgresql://user:pass@host:5432/dbname',
      validate: (v) => {
        if (!v) return 'Required'
        if (!v.startsWith('postgresql://') && !v.startsWith('postgres://'))
          return 'Must start with postgresql:// or postgres://'
      },
    })
    if (isCancel(url)) bail(url)
    databaseUrl = url as string
    dbPassword = ''
  }

  // ── Redis ──────────────────────────────────────────────────────────────────
  const managedRedis = await confirm({
    message: 'Manage Redis with Docker? (recommended — choose No to provide your own URL)',
    initialValue: true,
  })
  if (isCancel(managedRedis)) bail(managedRedis)

  let redisUrl = ''

  if (managedRedis) {
    redisUrl = 'redis://redis:6379'
  } else {
    const url = await text({
      message: 'Redis connection URL',
      placeholder: 'redis://user:pass@host:6379',
      validate: (v) => {
        if (!v) return 'Required'
        if (!v.startsWith('redis://') && !v.startsWith('rediss://'))
          return 'Must start with redis:// or rediss://'
      },
    })
    if (isCancel(url)) bail(url)
    redisUrl = url as string
  }

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

  // ── Optional ───────────────────────────────────────────────────────────────
  const wantResend = await confirm({
    message: 'Configure Resend for email invites? (optional)',
    initialValue: false,
  })
  if (isCancel(wantResend)) bail(wantResend)

  let resendApiKey = ''
  let feedbackToEmail = ''

  if (wantResend) {
    const key = await text({
      message: 'Resend API key',
      placeholder: 're_...',
    })
    if (isCancel(key)) bail(key)
    resendApiKey = (key as string) ?? ''

    const email = await text({
      message: 'Email address to receive feedback',
      placeholder: 'feedback@acme.com',
    })
    if (isCancel(email)) bail(email)
    feedbackToEmail = (email as string) ?? ''
  }

  // ── Auto-generated secrets ─────────────────────────────────────────────────
  const sessionSecret = generateSecret(32)
  const engineWebhookSecret = generateSecret(32)
  const adminSecret = generateSecret(16)

  return {
    appUrl: (appUrl as string).trim(),
    engineUrl: (engineUrl as string).trim(),
    sfdcClientId: sfdcClientId as string,
    sfdcClientSecret: sfdcClientSecret as string,
    sfdcLoginUrl,
    orgAlias: orgAlias as string,
    managedDb: managedDb as boolean,
    databaseUrl,
    dbPassword,
    managedRedis: managedRedis as boolean,
    redisUrl,
    adminEmail: adminEmail as string,
    adminPassword: adminPassword as string,
    resendApiKey,
    feedbackToEmail,
    sessionSecret,
    engineWebhookSecret,
    adminSecret,
  }
}
