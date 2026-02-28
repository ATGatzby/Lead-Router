-- ============================================================
-- Self-hosted schema updates
-- Brings the DB in sync with the current Prisma schema:
--   1. Make SFDC credential columns nullable (populated during onboarding)
--   2. Add Plan enum + new org columns (plan, isActive, quotas)
--   3. Create app_users table (CLI-managed admin users)
--   4. Create invites table
--   5. Add recordSnapshot to routing_logs
-- ============================================================

-- 1. Make SFDC credential columns nullable
ALTER TABLE "organizations" ALTER COLUMN "sfdcOrgId" DROP NOT NULL;
ALTER TABLE "organizations" ALTER COLUMN "sfdcInstanceUrl" DROP NOT NULL;
ALTER TABLE "organizations" ALTER COLUMN "oauthAccessToken" DROP NOT NULL;
ALTER TABLE "organizations" ALTER COLUMN "oauthRefreshToken" DROP NOT NULL;

-- 2. Plan enum + new org columns
CREATE TYPE "Plan" AS ENUM ('FREE', 'PAID');

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "plan"             "Plan"           NOT NULL DEFAULT 'FREE',
  ADD COLUMN IF NOT EXISTS "isActive"         BOOLEAN          NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "routingQuotaUsed" INTEGER          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "quotaResetAt"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 3. app_users table
CREATE TABLE "app_users" (
    "id"           TEXT         NOT NULL,
    "orgId"        TEXT         NOT NULL,
    "email"        TEXT         NOT NULL,
    "name"         TEXT         NOT NULL,
    "passwordHash" TEXT         NOT NULL,
    "role"         TEXT         NOT NULL DEFAULT 'ADMIN',
    "isActive"     BOOLEAN      NOT NULL DEFAULT true,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "app_users_orgId_email_key" ON "app_users"("orgId", "email");

ALTER TABLE "app_users"
  ADD CONSTRAINT "app_users_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. invites table
CREATE TABLE "invites" (
    "id"         TEXT         NOT NULL,
    "orgId"      TEXT         NOT NULL,
    "email"      TEXT         NOT NULL,
    "token"      TEXT         NOT NULL,
    "expiresAt"  TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invites_token_key" ON "invites"("token");

ALTER TABLE "invites"
  ADD CONSTRAINT "invites_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. recordSnapshot column in routing_logs
ALTER TABLE "routing_logs"
  ADD COLUMN IF NOT EXISTS "recordSnapshot" JSONB;
