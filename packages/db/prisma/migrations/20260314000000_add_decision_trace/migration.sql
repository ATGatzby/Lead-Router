-- AlterTable
ALTER TABLE "routing_logs" ADD COLUMN "decisionTrace" JSONB;

-- CreateIndex
CREATE INDEX "routing_logs_orgId_sfdcRecordId_createdAt_idx" ON "routing_logs"("orgId", "sfdcRecordId", "createdAt");
