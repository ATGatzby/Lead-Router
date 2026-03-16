-- AlterTable
ALTER TABLE "routing_rules" ADD COLUMN "searchMaxRecords" INTEGER,
ADD COLUMN "searchBatchSize" INTEGER;

-- CreateTable
CREATE TABLE "bulk_search_runs" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "recordsFound" INTEGER NOT NULL DEFAULT 0,
    "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
    "recordsRouted" INTEGER NOT NULL DEFAULT 0,
    "recordsFailed" INTEGER NOT NULL DEFAULT 0,
    "recordsSkipped" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "maxRecords" INTEGER,
    "batchSize" INTEGER,

    CONSTRAINT "bulk_search_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bulk_search_runs_orgId_ruleId_idx" ON "bulk_search_runs"("orgId", "ruleId");

-- CreateIndex
CREATE INDEX "bulk_search_runs_ruleId_status_idx" ON "bulk_search_runs"("ruleId", "status");

-- AddForeignKey
ALTER TABLE "bulk_search_runs" ADD CONSTRAINT "bulk_search_runs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_search_runs" ADD CONSTRAINT "bulk_search_runs_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "routing_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
