-- Migration: Route Match Config, Routing Branches, Default Owner
-- Adds: RouteMatchConfig, RoutingBranch, BranchCondition models
--       defaultOwner* fields on routing_rules
--       LeadMatchAction, ContactMatchAction, AccountMatchAction enums
--       MERGED value to RoutingStatus enum
--       Makes assignmentType nullable on routing_rules

-- 1. New enums
CREATE TYPE "LeadMatchAction" AS ENUM ('SFDC_MERGE', 'ASSIGN_TO_OWNER', 'ASSIGN_CUSTOM');
CREATE TYPE "ContactMatchAction" AS ENUM ('ASSIGN_TO_OWNER', 'ASSIGN_CUSTOM', 'SKIP');
CREATE TYPE "AccountMatchAction" AS ENUM ('ASSIGN_TO_OWNER', 'ASSIGN_CUSTOM', 'SKIP');

-- 2. Add MERGED to RoutingStatus enum
ALTER TYPE "RoutingStatus" ADD VALUE 'MERGED';

-- 3. Make assignmentType nullable on routing_rules
ALTER TABLE "routing_rules" ALTER COLUMN "assignmentType" DROP NOT NULL;

-- 4. Add defaultOwner* fields to routing_rules
ALTER TABLE "routing_rules"
  ADD COLUMN "defaultOwnerType" "AssignmentType",
  ADD COLUMN "defaultOwnerUserId" TEXT,
  ADD COLUMN "defaultOwnerTeamId" TEXT,
  ADD COLUMN "defaultOwnerQueueId" TEXT;

-- 5. Create routing_branches table
CREATE TABLE "routing_branches" (
  "id" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "label" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "assignmentType" "AssignmentType" NOT NULL,
  "assigneeUserId" TEXT,
  "assigneeTeamId" TEXT,
  "assigneeQueueId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "routing_branches_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "routing_branches"
  ADD CONSTRAINT "routing_branches_ruleId_fkey"
  FOREIGN KEY ("ruleId") REFERENCES "routing_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. Create branch_conditions table
CREATE TABLE "branch_conditions" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "fieldName" TEXT NOT NULL,
  "operator" TEXT NOT NULL,
  "value" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "branch_conditions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "branch_conditions"
  ADD CONSTRAINT "branch_conditions_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "routing_branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. Create route_match_configs table
CREATE TABLE "route_match_configs" (
  "id" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "checkLeads" BOOLEAN NOT NULL DEFAULT true,
  "checkContacts" BOOLEAN NOT NULL DEFAULT true,
  "checkAccounts" BOOLEAN NOT NULL DEFAULT false,
  "matchEmail" BOOLEAN NOT NULL DEFAULT true,
  "matchPhone" BOOLEAN NOT NULL DEFAULT false,
  "matchDomain" BOOLEAN NOT NULL DEFAULT false,
  "onLeadMatch" "LeadMatchAction" NOT NULL DEFAULT 'SFDC_MERGE',
  "leadAssignmentType" "AssignmentType",
  "leadAssigneeUserId" TEXT,
  "leadAssigneeTeamId" TEXT,
  "leadAssigneeQueueId" TEXT,
  "onContactMatch" "ContactMatchAction" NOT NULL DEFAULT 'ASSIGN_TO_OWNER',
  "contactAssignmentType" "AssignmentType",
  "contactAssigneeUserId" TEXT,
  "contactAssigneeTeamId" TEXT,
  "contactAssigneeQueueId" TEXT,
  "onAccountMatch" "AccountMatchAction" NOT NULL DEFAULT 'ASSIGN_TO_OWNER',
  "accountAssignmentType" "AssignmentType",
  "accountAssigneeUserId" TEXT,
  "accountAssigneeTeamId" TEXT,
  "accountAssigneeQueueId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "route_match_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "route_match_configs_ruleId_key" ON "route_match_configs"("ruleId");

ALTER TABLE "route_match_configs"
  ADD CONSTRAINT "route_match_configs_ruleId_fkey"
  FOREIGN KEY ("ruleId") REFERENCES "routing_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
