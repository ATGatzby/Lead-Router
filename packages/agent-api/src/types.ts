import type { PrismaClient } from "@lead-routing/db";

export type CrmType = "SALESFORCE" | "HUBSPOT";

export interface AgentContext {
  orgId: string;
  actorId: string;
  actorName: string;
  crmType: CrmType;
  prisma: PrismaClient;
  engineGateway?: EngineGateway;
}

export interface EngineGateway {
  routeSingle(payload: RoutePayload): Promise<RouteResult>;
  routeBatch(payload: BatchPayload): Promise<BatchResult>;
}

export interface RoutePayload {
  objectType: string;
  eventType: string;
  recordId: string;
  fields: Record<string, unknown>;
  ruleId?: string;
}

export interface BatchPayload {
  objectType: string;
  eventType: string;
  records: Array<{ recordId: string; fields: Record<string, unknown> }>;
  ruleId?: string;
}

export interface RouteResult {
  status: string;
  latencyMs?: number;
  ruleId?: string;
  assignedTo?: string;
}

export interface BatchResult {
  accepted: number;
  duplicates: number;
  batchId?: string;
}

export interface AgentResponse<T> {
  success: boolean;
  data: T;
  actions_taken: string[];
  warnings?: string[];
  next_actions?: Array<{ action: string; reason: string }>;
  error?: { code: string; message: string; remediation: string };
  _meta: {
    duration_ms: number;
    tool: string;
    crm_type: CrmType;
  };
}

export function ok<T>(
  data: T,
  actions: string[],
  tool: string,
  crmType: CrmType,
  durationMs: number,
  opts?: { warnings?: string[]; next_actions?: Array<{ action: string; reason: string }> },
): AgentResponse<T> {
  return {
    success: true,
    data,
    actions_taken: actions,
    warnings: opts?.warnings,
    next_actions: opts?.next_actions,
    _meta: { duration_ms: durationMs, tool, crm_type: crmType },
  };
}

export function fail(
  code: string,
  message: string,
  remediation: string,
  tool: string,
  crmType: CrmType,
  durationMs: number,
): AgentResponse<null> {
  return {
    success: false,
    data: null,
    actions_taken: [],
    error: { code, message, remediation },
    _meta: { duration_ms: durationMs, tool, crm_type: crmType },
  };
}
