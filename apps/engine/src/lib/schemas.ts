import { z } from "zod";

export const routePayloadSchema = z.object({
  sfdcOrgId: z.string().min(1),
  objectType: z.enum(["LEAD", "CONTACT", "ACCOUNT"]),
  eventType: z.enum(["INSERT", "UPDATE", "BOTH", "SEARCH"]),
  recordId: z.string().min(1),
  timestamp: z.string(),
  fields: z.record(z.string(), z.unknown()),
  ruleId: z.string().optional(),
}).passthrough();

export const batchPayloadSchema = z.object({
  sfdcOrgId: z.string().min(1),
  objectType: z.enum(["LEAD", "CONTACT", "ACCOUNT"]),
  eventType: z.enum(["INSERT", "UPDATE", "BOTH", "SEARCH"]),
  timestamp: z.string(),
  ruleId: z.string().optional(),
  records: z.array(z.object({
    recordId: z.string().min(1),
    fields: z.record(z.string(), z.unknown()),
  })).min(1).max(200),
}).passthrough();
