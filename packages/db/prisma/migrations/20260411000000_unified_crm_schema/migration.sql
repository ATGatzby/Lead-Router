-- CreateEnum
CREATE TYPE "CrmType" AS ENUM ('SALESFORCE', 'HUBSPOT');

-- CreateEnum
CREATE TYPE "CrmObjectType" AS ENUM ('LEAD', 'CONTACT', 'ACCOUNT', 'COMPANY', 'DEAL', 'USER');

-- CreateEnum
CREATE TYPE "SlaMetCriteria" AS ENUM ('ANY_ACTIVITY', 'STATUS_CHANGE', 'SPECIFIC_STATUS', 'MEETING_BOOKED');

-- CreateEnum
CREATE TYPE "SlaInstanceStatus" AS ENUM ('ACTIVE', 'MET', 'BREACHED', 'ESCALATED', 'CANCELLED');

-- AlterTable organizations - Add new CRM fields
ALTER TABLE "organizations" ADD COLUMN "crmType" "CrmType";
ALTER TABLE "organizations" ADD COLUMN "hubspotPortalId" TEXT;
ALTER TABLE "organizations" ADD COLUMN "hubspotAppId" TEXT;
ALTER TABLE "organizations" ADD COLUMN "hubspotSubscriptionId" TEXT;

-- Add unique constraint on hubspotPortalId
CREATE UNIQUE INDEX "organizations_hubspotPortalId_key" ON "organizations"("hubspotPortalId");

-- AlterTable users - Rename sfdcUserId to crmUserId
ALTER TABLE "users" RENAME COLUMN "sfdcUserId" TO "crmUserId";

-- Update unique constraint on users
DROP INDEX "users_orgId_sfdcUserId_key";
CREATE UNIQUE INDEX "users_orgId_crmUserId_key" ON "users"("orgId", "crmUserId");

-- AlterTable routing_logs - Rename sfdcRecordId to crmRecordId and update objectType
ALTER TABLE "routing_logs" RENAME COLUMN "sfdcRecordId" TO "crmRecordId";
ALTER TABLE "routing_logs" ADD COLUMN "objectType_new" "CrmObjectType";

-- Migrate existing SfdcObjectType values to CrmObjectType
UPDATE "routing_logs" SET "objectType_new" = 'LEAD' WHERE "objectType" = 'LEAD';
UPDATE "routing_logs" SET "objectType_new" = 'CONTACT' WHERE "objectType" = 'CONTACT';
UPDATE "routing_logs" SET "objectType_new" = 'ACCOUNT' WHERE "objectType" = 'ACCOUNT';

-- Drop old column and rename new one
ALTER TABLE "routing_logs" DROP COLUMN "objectType";
ALTER TABLE "routing_logs" RENAME COLUMN "objectType_new" TO "objectType";
ALTER TABLE "routing_logs" ALTER COLUMN "objectType" SET NOT NULL;

-- Update routing_logs index
DROP INDEX "routing_logs_orgId_sfdcRecordId_createdAt_idx";
CREATE INDEX "routing_logs_orgId_crmRecordId_createdAt_idx" ON "routing_logs"("orgId", "crmRecordId", "createdAt");

-- AlterTable conversion_tracking - Rename sfdcLeadId to crmRecordId
ALTER TABLE "conversion_tracking" RENAME COLUMN "sfdcLeadId" TO "crmRecordId";

-- Update conversion_tracking index
DROP INDEX "conversion_tracking_orgId_sfdcLeadId_idx";
CREATE INDEX "conversion_tracking_orgId_crmRecordId_idx" ON "conversion_tracking"("orgId", "crmRecordId");

-- AlterTable routing_rules - Migrate objectType to CrmObjectType
ALTER TABLE "routing_rules" ADD COLUMN "objectType_new" "CrmObjectType";
UPDATE "routing_rules" SET "objectType_new" = 'LEAD' WHERE "objectType" = 'LEAD';
UPDATE "routing_rules" SET "objectType_new" = 'CONTACT' WHERE "objectType" = 'CONTACT';
UPDATE "routing_rules" SET "objectType_new" = 'ACCOUNT' WHERE "objectType" = 'ACCOUNT';
ALTER TABLE "routing_rules" DROP COLUMN "objectType";
ALTER TABLE "routing_rules" RENAME COLUMN "objectType_new" TO "objectType";
ALTER TABLE "routing_rules" ALTER COLUMN "objectType" SET NOT NULL;

-- AlterTable field_schemas - Migrate objectType to CrmObjectType
ALTER TABLE "field_schemas" ADD COLUMN "objectType_new" "CrmObjectType";
UPDATE "field_schemas" SET "objectType_new" = 'LEAD' WHERE "objectType" = 'LEAD';
UPDATE "field_schemas" SET "objectType_new" = 'CONTACT' WHERE "objectType" = 'CONTACT';
UPDATE "field_schemas" SET "objectType_new" = 'ACCOUNT' WHERE "objectType" = 'ACCOUNT';
ALTER TABLE "field_schemas" DROP COLUMN "objectType";
ALTER TABLE "field_schemas" RENAME COLUMN "objectType_new" TO "objectType";
ALTER TABLE "field_schemas" ALTER COLUMN "objectType" SET NOT NULL;

-- Update field_schemas unique constraint
DROP INDEX "field_schemas_orgId_objectType_fieldApiName_key";
CREATE UNIQUE INDEX "field_schemas_orgId_objectType_fieldApiName_key" ON "field_schemas"("orgId", "objectType", "fieldApiName");

-- AlterTable routing_daily_aggregates - Migrate objectType to CrmObjectType
ALTER TABLE "routing_daily_aggregates" ADD COLUMN "objectType_new" "CrmObjectType";
UPDATE "routing_daily_aggregates" SET "objectType_new" = 'LEAD' WHERE "objectType" = 'LEAD';
UPDATE "routing_daily_aggregates" SET "objectType_new" = 'CONTACT' WHERE "objectType" = 'CONTACT';
UPDATE "routing_daily_aggregates" SET "objectType_new" = 'ACCOUNT' WHERE "objectType" = 'ACCOUNT';
ALTER TABLE "routing_daily_aggregates" DROP COLUMN "objectType";
ALTER TABLE "routing_daily_aggregates" RENAME COLUMN "objectType_new" TO "objectType";

-- Update routing_daily_aggregates unique constraint
DROP INDEX "routing_daily_aggregates_orgId_date_ruleId_pathLabel_branchId_key";
CREATE UNIQUE INDEX "routing_daily_aggregates_orgId_date_ruleId_pathLabel_branchId_key" ON "routing_daily_aggregates"("orgId", "date", "ruleId", "pathLabel", "branchId", "teamId", "assigneeId", "objectType");

-- AlterTable routing_flows - Migrate objectType to CrmObjectType
ALTER TABLE "routing_flows" ADD COLUMN "objectType_new" "CrmObjectType";
UPDATE "routing_flows" SET "objectType_new" = 'LEAD' WHERE "objectType" = 'LEAD';
UPDATE "routing_flows" SET "objectType_new" = 'CONTACT' WHERE "objectType" = 'CONTACT';
UPDATE "routing_flows" SET "objectType_new" = 'ACCOUNT' WHERE "objectType" = 'ACCOUNT';
ALTER TABLE "routing_flows" DROP COLUMN "objectType";
ALTER TABLE "routing_flows" RENAME COLUMN "objectType_new" TO "objectType";
ALTER TABLE "routing_flows" ALTER COLUMN "objectType" SET NOT NULL;

-- Update routing_flows unique constraint
DROP INDEX "routing_flows_orgId_objectType_key";
CREATE UNIQUE INDEX "routing_flows_orgId_objectType_key" ON "routing_flows"("orgId", "objectType");

-- Now we can safely drop the old SfdcObjectType enum
DROP TYPE "SfdcObjectType";

-- CreateTable sla_policies
CREATE TABLE "sla_policies" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deadlineMinutes" INTEGER NOT NULL,
    "metCriteria" "SlaMetCriteria" NOT NULL DEFAULT 'ANY_ACTIVITY',
    "metTargetValue" TEXT,
    "breachAction" TEXT NOT NULL DEFAULT 'REROUTE',
    "maxReroutes" INTEGER NOT NULL DEFAULT 3,
    "enforceBusinessHours" BOOLEAN NOT NULL DEFAULT false,
    "businessHoursStart" TEXT,
    "businessHoursEnd" TEXT,
    "businessTimezone" TEXT,
    "businessDays" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable sla_rule_assignments
CREATE TABLE "sla_rule_assignments" (
    "id" TEXT NOT NULL,
    "slaPolicyId" TEXT NOT NULL,
    "ruleId" TEXT,
    "teamId" TEXT,
    "branchId" TEXT,

    CONSTRAINT "sla_rule_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable sla_instances
CREATE TABLE "sla_instances" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "slaPolicyId" TEXT NOT NULL,
    "routingLogId" TEXT NOT NULL,
    "crmRecordId" TEXT NOT NULL,
    "objectType" "CrmObjectType" NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "ruleId" TEXT,
    "status" "SlaInstanceStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "metAt" TIMESTAMP(3),
    "breachedAt" TIMESTAMP(3),
    "responseTimeMs" INTEGER,
    "breachAction" TEXT,
    "reassignedTo" TEXT,
    "rerouteCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_instances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sla_policies_orgId_name_key" ON "sla_policies"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sla_rule_assignments_slaPolicyId_ruleId_teamId_branchId_key" ON "sla_rule_assignments"("slaPolicyId", "ruleId", "teamId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "sla_instances_routingLogId_key" ON "sla_instances"("routingLogId");

-- CreateIndex
CREATE INDEX "sla_instances_status_deadline_idx" ON "sla_instances"("status", "deadline");

-- CreateIndex
CREATE INDEX "sla_instances_orgId_status_idx" ON "sla_instances"("orgId", "status");

-- CreateIndex
CREATE INDEX "sla_instances_orgId_crmRecordId_status_idx" ON "sla_instances"("orgId", "crmRecordId", "status");

-- CreateIndex
CREATE INDEX "sla_instances_orgId_slaPolicyId_status_idx" ON "sla_instances"("orgId", "slaPolicyId", "status");

-- AddForeignKey
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_rule_assignments" ADD CONSTRAINT "sla_rule_assignments_slaPolicyId_fkey" FOREIGN KEY ("slaPolicyId") REFERENCES "sla_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_rule_assignments" ADD CONSTRAINT "sla_rule_assignments_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "routing_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_rule_assignments" ADD CONSTRAINT "sla_rule_assignments_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "round_robin_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_rule_assignments" ADD CONSTRAINT "sla_rule_assignments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "routing_branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_instances" ADD CONSTRAINT "sla_instances_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_instances" ADD CONSTRAINT "sla_instances_slaPolicyId_fkey" FOREIGN KEY ("slaPolicyId") REFERENCES "sla_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_instances" ADD CONSTRAINT "sla_instances_routingLogId_fkey" FOREIGN KEY ("routingLogId") REFERENCES "routing_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Update immutable_object_type_text function to use CrmObjectType
CREATE OR REPLACE FUNCTION immutable_object_type_text(val "CrmObjectType")
RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS
$$SELECT val::text$$;

-- Recreate functional unique index on routing_daily_aggregates
DROP INDEX IF EXISTS routing_daily_aggregates_unique_dimensions;
CREATE UNIQUE INDEX routing_daily_aggregates_unique_dimensions
ON routing_daily_aggregates (
  "orgId", date,
  COALESCE("ruleId", ''),
  COALESCE("pathLabel", ''),
  COALESCE("branchId", ''),
  COALESCE("teamId", ''),
  COALESCE("assigneeId", ''),
  COALESCE(immutable_object_type_text("objectType"), '')
);

-- Backfill: Set crmType to SALESFORCE for existing orgs with sfdcOrgId
UPDATE "organizations" SET "crmType" = 'SALESFORCE' WHERE "sfdcOrgId" IS NOT NULL;
