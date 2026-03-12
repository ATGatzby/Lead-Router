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

-- AddForeignKey
ALTER TABLE "trigger_conditions" ADD CONSTRAINT "trigger_conditions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "routing_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: add criteriaSyncedAt and triggerName to routing_rules
ALTER TABLE "routing_rules" ADD COLUMN "criteriaSyncedAt" TIMESTAMP(3);
ALTER TABLE "routing_rules" ADD COLUMN "triggerName" TEXT NOT NULL DEFAULT '';
