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

// Determine plan and seats from LICENSE_TIER env var
const licenseTier = (process.env.LICENSE_TIER || 'free').toLowerCase();
const plan = licenseTier === 'pro' ? 'PAID' : 'FREE';
const seatsPurchased = licenseTier === 'pro' ? 9999 : 10;
console.log(`[seed] License tier: ${licenseTier} → plan=${plan}, seats=${seatsPurchased}`);

const sql = `
-- Create initial organisation (plan and seats based on LICENSE_TIER)
INSERT INTO organizations (id, "webhookSecret", plan, "seatsPurchased", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), '${safeWebhookSecret}', '${plan}', ${seatsPurchased}, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM organizations);

-- Sync plan and seats from LICENSE_TIER env var (skip if activated via web UI)
UPDATE organizations
SET plan = '${plan}',
    "seatsPurchased" = ${seatsPurchased},
    "updatedAt" = NOW()
WHERE "licenseKey" IS NULL
  AND (plan != '${plan}' OR "seatsPurchased" != ${seatsPurchased});

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
