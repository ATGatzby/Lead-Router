-- AlterTable: add fuzzy matching columns to route_match_configs
ALTER TABLE "route_match_configs" ADD COLUMN "matchCompanyName" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "route_match_configs" ADD COLUMN "fuzzyMatchMode" TEXT NOT NULL DEFAULT 'STRICT';

-- CreateTable: company_aliases for caching AI similarity results
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

-- CreateIndex
CREATE UNIQUE INDEX "company_aliases_orgId_nameA_nameB_key" ON "company_aliases"("orgId", "nameA", "nameB");
CREATE INDEX "company_aliases_orgId_nameA_idx" ON "company_aliases"("orgId", "nameA");
CREATE INDEX "company_aliases_orgId_nameB_idx" ON "company_aliases"("orgId", "nameB");

-- AddForeignKey
ALTER TABLE "company_aliases" ADD CONSTRAINT "company_aliases_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
