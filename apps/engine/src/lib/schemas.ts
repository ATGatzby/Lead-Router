import { z } from "zod";

export const routePayloadSchema = z.object({
  sfdcOrgId: z.string().min(1),
  objectType: z.enum(["LEAD", "CONTACT", "ACCOUNT", "COMPANY", "DEAL"]),
  eventType: z.enum(["INSERT", "UPDATE", "BOTH", "SEARCH"]),
  recordId: z.string().min(1),
  timestamp: z.string(),
  fields: z.record(z.string(), z.unknown()),
  ruleId: z.string().optional(),
}).passthrough();

export const batchPayloadSchema = z.object({
  sfdcOrgId: z.string().min(1).optional(),
  hubspotPortalId: z.string().min(1).optional(),
  objectType: z.enum(["LEAD", "CONTACT", "ACCOUNT", "COMPANY", "DEAL"]),
  eventType: z.enum(["INSERT", "UPDATE", "BOTH", "SEARCH"]),
  timestamp: z.string(),
  ruleId: z.string().optional(),
  records: z.array(z.object({
    recordId: z.string().min(1),
    fields: z.record(z.string(), z.unknown()),
  })).min(1).max(200),
}).passthrough().refine(
  (d) => !!d.sfdcOrgId || !!d.hubspotPortalId,
  { message: "Either sfdcOrgId or hubspotPortalId is required" }
);
