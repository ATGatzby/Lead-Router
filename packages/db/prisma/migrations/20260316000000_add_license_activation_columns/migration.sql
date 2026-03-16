-- AlterTable
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "licenseKey" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "licenseTier" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "licenseValidUntil" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "licenseActivatedAt" TIMESTAMP(3);
