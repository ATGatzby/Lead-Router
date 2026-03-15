-- Fix: the existing @@unique constraint does not prevent duplicate rows
-- because PostgreSQL treats NULLs as distinct in unique indexes.

-- Step 1: Clean up any existing duplicate rows (keep the one with highest totalCount)
DELETE FROM "routing_daily_aggregates" a
USING "routing_daily_aggregates" b
WHERE a."orgId" = b."orgId"
  AND a."date" = b."date"
  AND a."objectType" IS NOT DISTINCT FROM b."objectType"
  AND a."ruleId" IS NOT DISTINCT FROM b."ruleId"
  AND a."pathLabel" IS NOT DISTINCT FROM b."pathLabel"
  AND a."branchId" IS NOT DISTINCT FROM b."branchId"
  AND a."teamId" IS NOT DISTINCT FROM b."teamId"
  AND a."assigneeId" IS NOT DISTINCT FROM b."assigneeId"
  AND a."id" < b."id";

-- Step 2: Create an immutable cast helper for the enum column.
-- PostgreSQL's built-in enum::text cast is only STABLE, not IMMUTABLE,
-- so it cannot be used directly in an index expression.
CREATE OR REPLACE FUNCTION immutable_object_type_text(val "SfdcObjectType")
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT val::text;
$$;

-- Step 3: Create a functional unique index using COALESCE to handle NULLs
CREATE UNIQUE INDEX "routing_daily_aggregates_dimension_key"
ON "routing_daily_aggregates" (
  "orgId",
  "date",
  COALESCE("ruleId", ''),
  COALESCE("pathLabel", ''),
  COALESCE("branchId", ''),
  COALESCE("teamId", ''),
  COALESCE("assigneeId", ''),
  COALESCE(immutable_object_type_text("objectType"), '')
);
