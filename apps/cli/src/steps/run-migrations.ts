import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { spinner } from '@clack/prompts'
import type { SshConnection } from '../utils/ssh.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Read a single value from a generated .env file.
 */
function readEnvVar(envFile: string, key: string): string {
  const content = fs.readFileSync(envFile, 'utf8')
  const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'))
  if (!match) throw new Error(`${key} not found in ${envFile}`)
  return match[1].trim().replace(/^["']|["']$/g, '')
}

/**
 * Build a DATABASE_URL pointing through the SSH tunnel.
 * The generated URL uses the Docker service name "postgres" — we replace
 * hostname and port with localhost + the local tunnel port.
 */
function getTunneledDbUrl(localDir: string, localPort: number): string {
  const rawUrl = readEnvVar(path.join(localDir, '.env.web'), 'DATABASE_URL')
  const parsed = new URL(rawUrl)
  parsed.hostname = 'localhost'
  parsed.port = String(localPort)
  return parsed.toString()
}

/**
 * Find the Prisma binary — bundled in the CLI's node_modules (global install)
 * or in the monorepo (dev).
 */
function findPrismaBin(): string {
  const candidates = [
    // npx / npm global install: @lead-routing/cli is nested under the scope dir,
    // so prisma lands 3 levels above dist/ in node_modules/.bin/
    // e.g. ~/.npm/_npx/HASH/node_modules/.bin/prisma
    path.join(__dirname, '../../../.bin/prisma'),
    path.join(__dirname, '../../../prisma/bin/prisma.js'),
    // Fallback: prisma nested inside the package's own node_modules (hoisted install)
    path.join(__dirname, '../node_modules/.bin/prisma'),
    path.join(__dirname, '../node_modules/prisma/bin/prisma.js'),
    // Monorepo dev paths
    path.resolve('packages/db/node_modules/.bin/prisma'),
    path.resolve('node_modules/.bin/prisma'),
    path.resolve('node_modules/.pnpm/node_modules/.bin/prisma'),
  ]
  const found = candidates.find(fs.existsSync)
  if (!found) throw new Error('Prisma binary not found — CLI may need to be reinstalled.')
  return found
}

/**
 * Run Prisma migrations via an SSH port-forward tunnel to the remote Postgres.
 *
 * Flow:
 * 1. Open SSH tunnel: local random port → remote localhost:5432
 * 2. prisma migrate deploy  (DATABASE_URL points at the tunnel)
 * 3. prisma db execute seed (same tunnel URL)
 * 4. Close the tunnel
 */
export async function runMigrations(
  ssh: SshConnection,
  localDir: string,
  adminEmail: string,
  adminPassword: string
): Promise<void> {
  const s = spinner()
  s.start('Opening secure tunnel to database')

  let tunnelClose: (() => void) | undefined

  try {
    const { localPort, close } = await ssh.tunnel(5432)
    tunnelClose = close
    s.stop(`Database tunnel open (local port ${localPort})`)

    await applyMigrations(localDir, localPort)
    await seedAdminUser(localDir, localPort, adminEmail, adminPassword)
  } finally {
    tunnelClose?.()
  }
}

async function applyMigrations(localDir: string, localPort: number): Promise<void> {
  const s = spinner()
  s.start('Running database migrations')

  try {
    const DATABASE_URL = getTunneledDbUrl(localDir, localPort)
    const prismaBin = findPrismaBin()

    // Schema: bundled in dist/prisma/ (global install) or monorepo fallback
    const bundledSchema = path.join(__dirname, 'prisma/schema.prisma')
    const monoSchema = path.resolve('packages/db/prisma/schema.prisma')
    const schemaPath = fs.existsSync(bundledSchema) ? bundledSchema : monoSchema

    await execa(prismaBin, ['migrate', 'deploy', '--schema', schemaPath], {
      env: { ...process.env, DATABASE_URL },
    })

    s.stop('Database migrations applied')
  } catch (err) {
    s.stop('Migrations failed')
    throw err
  }
}

/**
 * Seed the first admin AppUser using raw SQL via `prisma db execute`.
 * Password is PBKDF2 "salt:hash" format matching apps/web/lib/crypto.ts.
 */
async function seedAdminUser(
  localDir: string,
  localPort: number,
  adminEmail: string,
  adminPassword: string
): Promise<void> {
  const s = spinner()
  s.start('Creating admin user')

  try {
    const DATABASE_URL = getTunneledDbUrl(localDir, localPort)
    const webhookSecret = readEnvVar(path.join(localDir, '.env.engine'), 'ENGINE_WEBHOOK_SECRET')

    const salt = crypto.randomBytes(16).toString('hex')
    const pbkdf2Hash = crypto.pbkdf2Sync(adminPassword, salt, 310000, 32, 'sha256').toString('hex')
    const passwordHash = `${salt}:${pbkdf2Hash}`

    const safeEmail = adminEmail.replace(/'/g, "''")
    const safeWebhookSecret = webhookSecret.replace(/'/g, "''")

    const sql = `
-- Create initial organisation if none exists
INSERT INTO organizations (id, "webhookSecret", "createdAt", "updatedAt")
SELECT gen_random_uuid(), '${safeWebhookSecret}', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM organizations);

-- Create admin AppUser under the first org (idempotent)
INSERT INTO app_users (id, "orgId", email, name, "passwordHash", role, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), o.id, '${safeEmail}', 'Admin', '${passwordHash}', 'ADMIN', true, NOW(), NOW()
FROM organizations o
LIMIT 1
ON CONFLICT ("orgId", email) DO NOTHING;
`

    const prismaBin = findPrismaBin()
    await execa(prismaBin, ['db', 'execute', '--stdin', '--url', DATABASE_URL], { input: sql })

    s.stop('Admin user ready')
  } catch (err) {
    s.stop('Seed failed')
    throw err
  }
}
