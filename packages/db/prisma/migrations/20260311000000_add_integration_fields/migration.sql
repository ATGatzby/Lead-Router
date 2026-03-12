-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "packageDeployedAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN "packageDeployId" TEXT;
ALTER TABLE "organizations" ADD COLUMN "packageVersion" TEXT;
ALTER TABLE "organizations" ADD COLUMN "objectConfig" JSONB;
ALTER TABLE "organizations" ADD COLUMN "fieldsSyncedAt" TIMESTAMP(3);
