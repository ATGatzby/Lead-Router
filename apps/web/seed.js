#!/usr/bin/env node
// seed.js — runs inside Docker container on first boot
// Creates initial organization + admin user if none exist

const crypto = require('node:crypto');
const { execSync } = require('node:child_process');

const { ADMIN_EMAIL, ADMIN_PASSWORD, ENGINE_WEBHOOK_SECRET, DATABASE_URL } = process.env;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.log('[seed] ADMIN_EMAIL or ADMIN_PASSWORD not set, skipping seed');
  process.exit(0);
}

if (!ENGINE_WEBHOOK_SECRET) {
  console.log('[seed] ENGINE_WEBHOOK_SECRET not set, skipping seed');
  process.exit(0);
}

if (!DATABASE_URL) {
  console.log('[seed] DATABASE_URL not set, skipping seed');
  process.exit(0);
}

// Hash password using PBKDF2 (same format as apps/web/lib/crypto.ts)
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.pbkdf2Sync(ADMIN_PASSWORD, salt, 310000, 32, 'sha256').toString('hex');
const passwordHash = `${salt}:${hash}`;

const safeEmail = ADMIN_EMAIL.replace(/'/g, "''");
const safeWebhookSecret = ENGINE_WEBHOOK_SECRET.replace(/'/g, "''");

const sql = `
-- Create initial organisation if none exists (self-hosted defaults: PAID plan, unlimited seats)
INSERT INTO organizations (id, "webhookSecret", plan, "seatsPurchased", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), '${safeWebhookSecret}', 'PAID', 9999, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM organizations);

-- Create admin AppUser under the first org (idempotent)
INSERT INTO app_users (id, "orgId", email, name, "passwordHash", role, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), o.id, '${safeEmail}', 'Admin', '${passwordHash}', 'ADMIN', true, NOW(), NOW()
FROM organizations o
LIMIT 1
ON CONFLICT ("orgId", email) DO NOTHING;
`;

try {
  execSync(
    `node ./node_modules/prisma/build/index.js db execute --stdin --url "${DATABASE_URL}"`,
    { input: sql, stdio: ['pipe', 'inherit', 'inherit'] }
  );
  console.log('[seed] Admin user seeded successfully');
} catch (err) {
  console.error('[seed] Seed failed:', err.message);
  process.exit(1);
}
