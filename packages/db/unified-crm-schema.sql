-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CrmType" AS ENUM ('SALESFORCE', 'HUBSPOT');

-- CreateEnum
CREATE TYPE "CrmObjectType" AS ENUM ('LEAD', 'CONTACT', 'ACCOUNT', 'COMPANY', 'DEAL', 'USER');

-- CreateEnum
CREATE TYPE "SlaMetCriteria" AS ENUM ('ANY_ACTIVITY', 'STATUS_CHANGE', 'SPECIFIC_STATUS', 'MEETING_BOOKED');

-- CreateEnum
CREATE TYPE "SlaInstanceStatus" AS ENUM ('ACTIVE', 'MET', 'BREACHED', 'ESCALATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TriggerEvent" AS ENUM ('INSERT', 'UPDATE', 'BOTH', 'SEARCH');

-- CreateEnum
CREATE TYPE "RouteType" AS ENUM ('REALTIME', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "RuleStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AssignmentType" AS ENUM ('USER', 'ROUND_ROBIN', 'QUEUE');

-- CreateEnum
CREATE TYPE "TeamMemberStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "RoutingStatus" AS ENUM ('SUCCESS', 'FAILED', 'UNMATCHED', 'RETRY', 'MERGED', 'COOLDOWN_SKIPPED', 'STAMP_SKIPPED');

-- CreateEnum
CREATE TYPE "LeadMatchAction" AS ENUM ('SFDC_MERGE', 'ASSIGN_TO_OWNER', 'ASSIGN_CUSTOM');

-- CreateEnum
CREATE TYPE "ContactMatchAction" AS ENUM ('ASSIGN_TO_OWNER', 'ASSIGN_CUSTOM', 'SKIP');

-- CreateEnum
CREATE TYPE "AccountMatchAction" AS ENUM ('ASSIGN_TO_OWNER', 'ASSIGN_CUSTOM', 'SKIP');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'PAID');

-- CreateEnum
CREATE TYPE "FlowStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "FlowNodeType" AS ENUM ('ENTRY', 'DECISION', 'BRANCH_DECISION', 'MATCH', 'ASSIGNMENT', 'UPDATE_FIELD', 'CREATE_TASK', 'FILTER', 'DEFAULT');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "crmType" "CrmType",
    "sfdcOrgId" TEXT,
    "sfdcInstanceUrl" TEXT,
    "oauthAccessToken" TEXT,
    "oauthRefreshToken" TEXT,
    "webhookSecret" TEXT NOT NULL,
    "hubspotPortalId" TEXT,
    "hubspotAppId" TEXT,
    "hubspotSubscriptionId" TEXT,
    "packageDeployedAt" TIMESTAMP(3),
    "packageDeployId" TEXT,
    "packageVersion" TEXT,
    "objectConfig" JSONB,
    "fieldsSyncedAt" TIMESTAMP(3),
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "seatsPurchased" INTEGER NOT NULL DEFAULT 5,
    "seatsUsed" INTEGER NOT NULL DEFAULT 0,
    "routingQuotaUsed" INTEGER NOT NULL DEFAULT 0,
    "quotaResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "onboardingDone" BOOLEAN NOT NULL DEFAULT false,
    "notificationWebhookUrl" TEXT,
    "aiProvider" TEXT,
    "aiApiKey" TEXT,
    "aiModelName" TEXT,
    "aiBaseUrl" TEXT,
    "aiCustomHeaders" JSONB,
    "aiChatCount" INTEGER NOT NULL DEFAULT 0,
    "licenseKey" TEXT,
    "licenseTier" TEXT,
    "licenseValidUntil" TIMESTAMP(3),
    "licenseActivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "routingMode" JSONB,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_users" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "crmUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "profile" TEXT,
    "department" TEXT,
    "isLicensed" BOOLEAN NOT NULL DEFAULT false,
    "licensedVia" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRoutedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round_robin_teams" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "distributionType" TEXT NOT NULL DEFAULT 'round-robin',
    "pointerIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "round_robin_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "TeamMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "weight" INTEGER NOT NULL DEFAULT 1,
    "assignmentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_rules" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "objectType" "CrmObjectType" NOT NULL,
    "triggerEvent" "TriggerEvent" NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "status" "RuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "assignmentType" "AssignmentType",
    "assigneeUserId" TEXT,
    "assigneeTeamId" TEXT,
    "assigneeQueueId" TEXT,
    "isDryRun" BOOLEAN NOT NULL DEFAULT false,
    "triggerName" TEXT NOT NULL DEFAULT '',
    "criteriaSyncedAt" TIMESTAMP(3),
    "routeType" "RouteType" NOT NULL DEFAULT 'REALTIME',
    "scheduleFrequency" TEXT,
    "scheduleTime" TEXT,
    "scheduleTimezone" TEXT,
    "scheduleCron" TEXT,
    "searchCriteria" JSONB,
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "lastRunRecords" INTEGER,
    "lastRunDurationMs" INTEGER,
    "totalRuns" INTEGER NOT NULL DEFAULT 0,
    "totalRecordsRouted" INTEGER NOT NULL DEFAULT 0,
    "searchMaxRecords" INTEGER,
    "searchBatchSize" INTEGER,
    "defaultOwnerType" "AssignmentType",
    "defaultOwnerUserId" TEXT,
    "defaultOwnerTeamId" TEXT,
    "defaultOwnerQueueId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_branches" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "label" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "assignmentType" "AssignmentType",
    "assigneeUserId" TEXT,
    "assigneeTeamId" TEXT,
    "assigneeQueueId" TEXT,
    "steps" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routing_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_conditions" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL DEFAULT 'TEXT',
    "operator" TEXT NOT NULL,
    "value" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "branch_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trigger_conditions" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL DEFAULT 'TEXT',
    "operator" TEXT NOT NULL,
    "value" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "trigger_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_match_configs" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "checkLeads" BOOLEAN NOT NULL DEFAULT true,
    "checkContacts" BOOLEAN NOT NULL DEFAULT true,
    "checkAccounts" BOOLEAN NOT NULL DEFAULT false,
    "matchEmail" BOOLEAN NOT NULL DEFAULT true,
    "matchPhone" BOOLEAN NOT NULL DEFAULT false,
    "matchDomain" BOOLEAN NOT NULL DEFAULT false,
    "matchCompanyName" BOOLEAN NOT NULL DEFAULT false,
    "fuzzyMatchMode" TEXT NOT NULL DEFAULT 'STRICT',
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "route_match_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_conditions" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "value" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rule_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_logs" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "crmRecordId" TEXT NOT NULL,
    "objectType" "CrmObjectType" NOT NULL,
    "eventType" "TriggerEvent" NOT NULL,
    "ruleId" TEXT,
    "ruleName" TEXT,
    "pathLabel" TEXT,
    "assigneeId" TEXT,
    "assigneeName" TEXT,
    "assignmentType" "AssignmentType",
    "isDryRun" BOOLEAN NOT NULL DEFAULT false,
    "status" "RoutingStatus" NOT NULL,
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "recordSnapshot" JSONB,
    "decisionTrace" JSONB,
    "teamId" TEXT,
    "teamName" TEXT,
    "routingDurationMs" INTEGER,
    "branchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "flowId" TEXT,
    "flowNodePath" JSONB,

    CONSTRAINT "routing_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "beforeState" JSONB,
    "afterState" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_flows" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "objectType" "CrmObjectType" NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Untitled Flow',
    "status" "FlowStatus" NOT NULL DEFAULT 'DRAFT',
    "triggerEvent" "TriggerEvent" NOT NULL DEFAULT 'BOTH',
    "isDryRun" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routing_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_nodes" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "type" "FlowNodeType" NOT NULL,
    "label" TEXT,
    "positionX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positionY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "config" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_edges" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "label" TEXT,
    "sourceHandle" TEXT,
    "targetHandle" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sfdc_queues" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sfdcQueueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isLicensed" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sfdc_queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_schemas" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "objectType" "CrmObjectType" NOT NULL,
    "fieldApiName" TEXT NOT NULL,
    "fieldLabel" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "picklistValues" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_schemas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_info" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entityName" TEXT,
    "gstin" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pinCode" TEXT,
    "invoiceEmail" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_info_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_daily_aggregates" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "ruleId" TEXT,
    "pathLabel" TEXT,
    "branchId" TEXT,
    "teamId" TEXT,
    "assigneeId" TEXT,
    "objectType" "CrmObjectType",
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

-- CreateTable
CREATE TABLE "conversion_tracking" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "routingLogId" TEXT NOT NULL,
    "crmRecordId" TEXT NOT NULL,
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

-- CreateTable
CREATE TABLE "company_aliases" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "nameA" TEXT NOT NULL,
    "nameB" TEXT NOT NULL,
    "isSimilar" BOOLEAN NOT NULL,
    "confidence" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'AI',
    "hitCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_aliases_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "api_tokens" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY['read', 'route']::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_custom_prompts" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "context" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_custom_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agent_logs" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "entityName" TEXT,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_chat_feedback" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "userMessage" TEXT NOT NULL,
    "aiResponse" TEXT NOT NULL,
    "toolsUsed" JSONB,
    "context" TEXT,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_chat_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "sla_rule_assignments" (
    "id" TEXT NOT NULL,
    "slaPolicyId" TEXT NOT NULL,
    "ruleId" TEXT,
    "teamId" TEXT,
    "branchId" TEXT,

    CONSTRAINT "sla_rule_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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
CREATE UNIQUE INDEX "organizations_sfdcOrgId_key" ON "organizations"("sfdcOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_hubspotPortalId_key" ON "organizations"("hubspotPortalId");

-- CreateIndex
CREATE UNIQUE INDEX "app_users_orgId_email_key" ON "app_users"("orgId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "invites_token_key" ON "invites"("token");

-- CreateIndex
CREATE UNIQUE INDEX "users_orgId_crmUserId_key" ON "users"("orgId", "crmUserId");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_teamId_userId_key" ON "team_members"("teamId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "route_match_configs_ruleId_key" ON "route_match_configs"("ruleId");

-- CreateIndex
CREATE INDEX "routing_logs_orgId_createdAt_idx" ON "routing_logs"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "routing_logs_orgId_status_idx" ON "routing_logs"("orgId", "status");

-- CreateIndex
CREATE INDEX "routing_logs_orgId_teamId_idx" ON "routing_logs"("orgId", "teamId");

-- CreateIndex
CREATE INDEX "routing_logs_orgId_ruleId_idx" ON "routing_logs"("orgId", "ruleId");

-- CreateIndex
CREATE INDEX "routing_logs_orgId_crmRecordId_createdAt_idx" ON "routing_logs"("orgId", "crmRecordId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_orgId_createdAt_idx" ON "audit_logs"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "routing_flows_orgId_objectType_key" ON "routing_flows"("orgId", "objectType");

-- CreateIndex
CREATE UNIQUE INDEX "sfdc_queues_orgId_sfdcQueueId_key" ON "sfdc_queues"("orgId", "sfdcQueueId");

-- CreateIndex
CREATE UNIQUE INDEX "field_schemas_orgId_objectType_fieldApiName_key" ON "field_schemas"("orgId", "objectType", "fieldApiName");

-- CreateIndex
CREATE UNIQUE INDEX "billing_info_orgId_key" ON "billing_info"("orgId");

-- CreateIndex
CREATE INDEX "sessions_orgId_idx" ON "sessions"("orgId");

-- CreateIndex
CREATE INDEX "routing_daily_aggregates_orgId_date_idx" ON "routing_daily_aggregates"("orgId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "routing_daily_aggregates_orgId_date_ruleId_pathLabel_branch_key" ON "routing_daily_aggregates"("orgId", "date", "ruleId", "pathLabel", "branchId", "teamId", "assigneeId", "objectType");

-- CreateIndex
CREATE UNIQUE INDEX "conversion_tracking_routingLogId_key" ON "conversion_tracking"("routingLogId");

-- CreateIndex
CREATE INDEX "conversion_tracking_orgId_isConverted_idx" ON "conversion_tracking"("orgId", "isConverted");

-- CreateIndex
CREATE INDEX "conversion_tracking_orgId_crmRecordId_idx" ON "conversion_tracking"("orgId", "crmRecordId");

-- CreateIndex
CREATE INDEX "company_aliases_orgId_nameA_idx" ON "company_aliases"("orgId", "nameA");

-- CreateIndex
CREATE INDEX "company_aliases_orgId_nameB_idx" ON "company_aliases"("orgId", "nameB");

-- CreateIndex
CREATE UNIQUE INDEX "company_aliases_orgId_nameA_nameB_key" ON "company_aliases"("orgId", "nameA", "nameB");

-- CreateIndex
CREATE INDEX "bulk_search_runs_orgId_ruleId_idx" ON "bulk_search_runs"("orgId", "ruleId");

-- CreateIndex
CREATE INDEX "bulk_search_runs_ruleId_status_idx" ON "bulk_search_runs"("ruleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_tokenHash_key" ON "api_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "api_tokens_orgId_idx" ON "api_tokens"("orgId");

-- CreateIndex
CREATE INDEX "ai_custom_prompts_orgId_type_isActive_idx" ON "ai_custom_prompts"("orgId", "type", "isActive");

-- CreateIndex
CREATE INDEX "ai_agent_logs_orgId_createdAt_idx" ON "ai_agent_logs"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_agent_logs_orgId_context_idx" ON "ai_agent_logs"("orgId", "context");

-- CreateIndex
CREATE INDEX "ai_chat_feedback_orgId_rating_idx" ON "ai_chat_feedback"("orgId", "rating");

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
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_robin_teams" ADD CONSTRAINT "round_robin_teams_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "round_robin_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_assigneeTeamId_fkey" FOREIGN KEY ("assigneeTeamId") REFERENCES "round_robin_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_assigneeQueueId_fkey" FOREIGN KEY ("assigneeQueueId") REFERENCES "sfdc_queues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_defaultOwnerUserId_fkey" FOREIGN KEY ("defaultOwnerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_defaultOwnerTeamId_fkey" FOREIGN KEY ("defaultOwnerTeamId") REFERENCES "round_robin_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_defaultOwnerQueueId_fkey" FOREIGN KEY ("defaultOwnerQueueId") REFERENCES "sfdc_queues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_branches" ADD CONSTRAINT "routing_branches_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "routing_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_branches" ADD CONSTRAINT "routing_branches_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_branches" ADD CONSTRAINT "routing_branches_assigneeTeamId_fkey" FOREIGN KEY ("assigneeTeamId") REFERENCES "round_robin_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_branches" ADD CONSTRAINT "routing_branches_assigneeQueueId_fkey" FOREIGN KEY ("assigneeQueueId") REFERENCES "sfdc_queues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_conditions" ADD CONSTRAINT "branch_conditions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "routing_branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trigger_conditions" ADD CONSTRAINT "trigger_conditions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "routing_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_match_configs" ADD CONSTRAINT "route_match_configs_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "routing_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_conditions" ADD CONSTRAINT "rule_conditions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "routing_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_logs" ADD CONSTRAINT "routing_logs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_logs" ADD CONSTRAINT "routing_logs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "routing_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_flows" ADD CONSTRAINT "routing_flows_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_nodes" ADD CONSTRAINT "flow_nodes_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "routing_flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_edges" ADD CONSTRAINT "flow_edges_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "routing_flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_edges" ADD CONSTRAINT "flow_edges_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "flow_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_edges" ADD CONSTRAINT "flow_edges_toId_fkey" FOREIGN KEY ("toId") REFERENCES "flow_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sfdc_queues" ADD CONSTRAINT "sfdc_queues_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_schemas" ADD CONSTRAINT "field_schemas_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_info" ADD CONSTRAINT "billing_info_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_daily_aggregates" ADD CONSTRAINT "routing_daily_aggregates_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_tracking" ADD CONSTRAINT "conversion_tracking_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_tracking" ADD CONSTRAINT "conversion_tracking_routingLogId_fkey" FOREIGN KEY ("routingLogId") REFERENCES "routing_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_aliases" ADD CONSTRAINT "company_aliases_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_search_runs" ADD CONSTRAINT "bulk_search_runs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_search_runs" ADD CONSTRAINT "bulk_search_runs_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "routing_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_custom_prompts" ADD CONSTRAINT "ai_custom_prompts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_logs" ADD CONSTRAINT "ai_agent_logs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_chat_feedback" ADD CONSTRAINT "ai_chat_feedback_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

