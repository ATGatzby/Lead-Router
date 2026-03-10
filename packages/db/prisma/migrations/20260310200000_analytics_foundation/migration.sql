-- Add analytics columns to routing_logs
ALTER TABLE "routing_logs" ADD COLUMN "routingDurationMs" INTEGER;
ALTER TABLE "routing_logs" ADD COLUMN "branchId" TEXT;

-- AddForeignKey
ALTER TABLE "routing_logs" ADD CONSTRAINT "routing_logs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "routing_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "routing_logs_orgId_ruleId_idx" ON "routing_logs"("orgId", "ruleId");

-- CreateTable: routing_daily_aggregates
CREATE TABLE "routing_daily_aggregates" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "ruleId" TEXT,
    "pathLabel" TEXT,
    "branchId" TEXT,
    "teamId" TEXT,
    "assigneeId" TEXT,
    "objectType" "SfdcObjectType",
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "mergedCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "avgDurationMs" DOUBLE PRECISION,
    "minDurationMs" INTEGER,
    "maxDurationMs" INTEGER,
    "p50DurationMs" INTEGER,
    "p95DurationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routing_daily_aggregates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "routing_daily_aggregates_orgId_date_idx" ON "routing_daily_aggregates"("orgId", "date");

-- CreateIndex (unique composite)
CREATE UNIQUE INDEX "routing_daily_aggregates_orgId_date_ruleId_pathLabel_branch_key" ON "routing_daily_aggregates"("orgId", "date", "ruleId", "pathLabel", "branchId", "teamId", "assigneeId", "objectType");

-- AddForeignKey
ALTER TABLE "routing_daily_aggregates" ADD CONSTRAINT "routing_daily_aggregates_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: conversion_tracking
CREATE TABLE "conversion_tracking" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "routingLogId" TEXT NOT NULL,
    "sfdcLeadId" TEXT NOT NULL,
    "isConverted" BOOLEAN NOT NULL DEFAULT false,
    "convertedAt" TIMESTAMP(3),
    "opportunityId" TEXT,
    "opportunityAmount" DOUBLE PRECISION,
    "opportunityStageName" TEXT,
    "ruleId" TEXT,
    "ruleName" TEXT,
    "pathLabel" TEXT,
    "teamId" TEXT,
    "assigneeId" TEXT,
    "assigneeName" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversion_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversion_tracking_routingLogId_key" ON "conversion_tracking"("routingLogId");

-- CreateIndex
CREATE INDEX "conversion_tracking_orgId_isConverted_idx" ON "conversion_tracking"("orgId", "isConverted");

-- CreateIndex
CREATE INDEX "conversion_tracking_orgId_sfdcLeadId_idx" ON "conversion_tracking"("orgId", "sfdcLeadId");

-- AddForeignKey
ALTER TABLE "conversion_tracking" ADD CONSTRAINT "conversion_tracking_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_tracking" ADD CONSTRAINT "conversion_tracking_routingLogId_fkey" FOREIGN KEY ("routingLogId") REFERENCES "routing_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
