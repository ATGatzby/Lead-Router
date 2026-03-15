-- Add licensedVia to User model
ALTER TABLE "users" ADD COLUMN "licensedVia" TEXT;

-- Add isLicensed to SfdcQueue model
ALTER TABLE "sfdc_queues" ADD COLUMN "isLicensed" BOOLEAN NOT NULL DEFAULT false;
