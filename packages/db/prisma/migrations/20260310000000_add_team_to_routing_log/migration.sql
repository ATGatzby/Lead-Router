-- AlterTable
ALTER TABLE "routing_logs" ADD COLUMN "teamId" TEXT;
ALTER TABLE "routing_logs" ADD COLUMN "teamName" TEXT;

-- CreateIndex
CREATE INDEX "routing_logs_orgId_teamId_idx" ON "routing_logs"("orgId", "teamId");
