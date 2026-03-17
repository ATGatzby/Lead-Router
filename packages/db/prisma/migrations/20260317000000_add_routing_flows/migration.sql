-- CreateEnum
CREATE TYPE "FlowStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "FlowNodeType" AS ENUM ('ENTRY', 'DECISION', 'BRANCH_DECISION', 'MATCH', 'ASSIGNMENT', 'UPDATE_FIELD', 'CREATE_TASK', 'FILTER', 'DEFAULT');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "routingMode" JSONB;

-- AlterTable
ALTER TABLE "routing_logs" ADD COLUMN "flowId" TEXT,
ADD COLUMN "flowNodePath" JSONB;

-- CreateTable
CREATE TABLE "routing_flows" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "objectType" "SfdcObjectType" NOT NULL,
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
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_edges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "routing_flows_orgId_objectType_key" ON "routing_flows"("orgId", "objectType");

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
