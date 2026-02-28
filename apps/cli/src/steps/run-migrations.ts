import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { execa } from 'execa'
import { spinner } from '@clack/prompts'

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
 * The generated DATABASE_URL uses the docker compose service name "postgres".
 * From the host machine the container is reachable on localhost:5432 instead.
 */
function getHostDbUrl(dir: string): string {
  return readEnvVar(path.join(dir, '.env.web'), 'DATABASE_URL').replace('@postgres:', '@localhost:')
}

/**
 * Run Prisma migrations from the host CLI process against the exposed postgres port.
 *
 * This avoids exec-ing into the web container (which requires a full image rebuild
 * every time a Prisma CLI fix is needed). The host machine already has the prisma
 * binary in the monorepo node_modules and the schema at packages/db/prisma/.
 */
export async function runMigrations(dir: string, _adminEmail: string, _adminPassword: string): Promise<void> {
  const s = spinner()
  s.start('Running database migrations')

  try {
    const DATABASE_URL = getHostDbUrl(dir)
    // pnpm puts prisma in the package that declares it as a dep, not the workspace root
    const candidates = [
      path.resolve('packages/db/node_modules/.bin/prisma'),
      path.resolve('node_modules/.bin/prisma'),
      path.resolve('node_modules/.pnpm/node_modules/.bin/prisma'),
    ]
    const prismaBin = candidates.find(fs.existsSync)
    if (!prismaBin) {
      throw new Error('Prisma binary not found — run lead-routing from the project root directory.')
    }
    const schemaPath = path.resolve('packages/db/prisma/schema.prisma')

    // Generate the client on the host so the seed step can import @prisma/client
    await execa(prismaBin, ['generate', '--schema', schemaPath], {
      env: { ...process.env, DATABASE_URL },
    })

    // Apply all pending migrations
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
 *
 * This avoids any @prisma/client module resolution issues entirely.
 * The SQL creates the first Organisation (if none exists) then creates the
 * admin AppUser under it — both operations are idempotent.
 */
export async function seedAdminUser(
  dir: string,
  adminEmail: string,
  adminPassword: string
): Promise<void> {
  const s = spinner()
  s.start('Creating admin user')

  try {
    const DATABASE_URL = getHostDbUrl(dir)
    const webhookSecret = readEnvVar(path.join(dir, '.env.engine'), 'ENGINE_WEBHOOK_SECRET')
    // Must match apps/web/lib/crypto.ts hashPassword() — PBKDF2, "salt:hash" format
    const salt = crypto.randomBytes(16).toString('hex')
    const pbkdf2Hash = crypto.pbkdf2Sync(adminPassword, salt, 310000, 32, 'sha256').toString('hex')
    const passwordHash = `${salt}:${pbkdf2Hash}`

    // Escape single quotes for SQL string literals
    const safeEmail = adminEmail.replace(/'/g, "''")
    const safeWebhookSecret = webhookSecret.replace(/'/g, "''")

    // Create the first org if none exists, then insert the admin user under it.
    // gen_random_uuid() is available in PostgreSQL 13+ (pgcrypto not needed).
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

    const candidates = [
      path.resolve('packages/db/node_modules/.bin/prisma'),
      path.resolve('node_modules/.bin/prisma'),
    ]
    const prismaBin = candidates.find(fs.existsSync)
    if (!prismaBin) throw new Error('Prisma binary not found.')

    await execa(prismaBin, ['db', 'execute', '--stdin', '--url', DATABASE_URL], {
      input: sql,
    })

    s.stop('Admin user ready')
  } catch (err) {
    s.stop('Seed failed')
    throw err
  }
}
