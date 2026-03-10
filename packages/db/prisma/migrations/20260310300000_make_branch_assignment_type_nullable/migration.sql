-- AlterTable: make assignmentType nullable on routing_branches (allows saving unconfigured branches)
ALTER TABLE "routing_branches" ALTER COLUMN "assignmentType" DROP NOT NULL;
