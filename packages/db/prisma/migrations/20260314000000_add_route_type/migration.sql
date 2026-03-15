-- AlterEnum: Add SEARCH to TriggerEvent
ALTER TYPE "TriggerEvent" ADD VALUE 'SEARCH';

-- CreateEnum: RouteType
CREATE TYPE "RouteType" AS ENUM ('REALTIME', 'SCHEDULED');

-- AlterTable: Add route type and scheduled fields to routing_rules
ALTER TABLE "routing_rules" ADD COLUMN "routeType" "RouteType" NOT NULL DEFAULT 'REALTIME';
ALTER TABLE "routing_rules" ADD COLUMN "scheduleFrequency" TEXT;
ALTER TABLE "routing_rules" ADD COLUMN "scheduleTime" TEXT;
ALTER TABLE "routing_rules" ADD COLUMN "scheduleTimezone" TEXT;
ALTER TABLE "routing_rules" ADD COLUMN "scheduleCron" TEXT;
ALTER TABLE "routing_rules" ADD COLUMN "searchCriteria" JSONB;
ALTER TABLE "routing_rules" ADD COLUMN "lastRunAt" TIMESTAMP(3);
ALTER TABLE "routing_rules" ADD COLUMN "lastRunStatus" TEXT;
ALTER TABLE "routing_rules" ADD COLUMN "lastRunRecords" INTEGER;
ALTER TABLE "routing_rules" ADD COLUMN "lastRunDurationMs" INTEGER;
ALTER TABLE "routing_rules" ADD COLUMN "totalRuns" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "routing_rules" ADD COLUMN "totalRecordsRouted" INTEGER NOT NULL DEFAULT 0;
