-- AlterTable
ALTER TABLE "route_match_configs" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "routing_branches" ALTER COLUMN "updatedAt" DROP DEFAULT;

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

-- CreateIndex
CREATE INDEX "ai_custom_prompts_orgId_type_isActive_idx" ON "ai_custom_prompts"("orgId", "type", "isActive");

-- CreateIndex
CREATE INDEX "ai_agent_logs_orgId_createdAt_idx" ON "ai_agent_logs"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_agent_logs_orgId_context_idx" ON "ai_agent_logs"("orgId", "context");

-- CreateIndex
CREATE INDEX "ai_chat_feedback_orgId_rating_idx" ON "ai_chat_feedback"("orgId", "rating");

-- AddForeignKey
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_defaultOwnerUserId_fkey" FOREIGN KEY ("defaultOwnerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_defaultOwnerTeamId_fkey" FOREIGN KEY ("defaultOwnerTeamId") REFERENCES "round_robin_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_defaultOwnerQueueId_fkey" FOREIGN KEY ("defaultOwnerQueueId") REFERENCES "sfdc_queues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_branches" ADD CONSTRAINT "routing_branches_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_branches" ADD CONSTRAINT "routing_branches_assigneeTeamId_fkey" FOREIGN KEY ("assigneeTeamId") REFERENCES "round_robin_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_branches" ADD CONSTRAINT "routing_branches_assigneeQueueId_fkey" FOREIGN KEY ("assigneeQueueId") REFERENCES "sfdc_queues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_custom_prompts" ADD CONSTRAINT "ai_custom_prompts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_logs" ADD CONSTRAINT "ai_agent_logs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_chat_feedback" ADD CONSTRAINT "ai_chat_feedback_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
