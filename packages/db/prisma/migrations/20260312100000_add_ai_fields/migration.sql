-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "aiProvider" TEXT;
ALTER TABLE "organizations" ADD COLUMN "aiApiKey" TEXT;
ALTER TABLE "organizations" ADD COLUMN "aiModelName" TEXT;
ALTER TABLE "organizations" ADD COLUMN "aiBaseUrl" TEXT;
ALTER TABLE "organizations" ADD COLUMN "aiCustomHeaders" JSONB;
ALTER TABLE "organizations" ADD COLUMN "aiChatCount" INTEGER NOT NULL DEFAULT 0;
