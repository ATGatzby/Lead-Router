-- AlterTable (column already added in init migration if starting fresh)
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "notificationWebhookUrl" TEXT;
