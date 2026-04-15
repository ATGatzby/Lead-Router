import { createHash } from "node:crypto";

export async function logToolCall(
  prisma: any,
  data: {
    orgId: string;
    tokenId: string;
    tool: string;
    category: string;
    status: "success" | "error" | "rate_limited";
    errorCode?: string;
    durationMs: number;
    input: Record<string, unknown>;
    responseSize: number;
    crmType: string;
    warnings?: string[];
  }
) {
  const inputHash = createHash("sha256")
    .update(JSON.stringify(data.input))
    .digest("hex")
    .slice(0, 16);

  await prisma.toolCallLog.create({
    data: {
      orgId: data.orgId,
      tokenId: data.tokenId,
      tool: data.tool,
      category: data.category,
      status: data.status,
      errorCode: data.errorCode,
      durationMs: data.durationMs,
      inputHash,
      responseSize: data.responseSize,
      crmType: data.crmType,
      warnings: data.warnings ?? [],
    },
  }).catch((err: unknown) => {
    // Don't let logging failures break the API
    console.error("Failed to log tool call:", err);
  });
}

// Map action names to categories
export function getCategory(tool: string): string {
  const SETUP = ["setup-team", "setup-routing-rule", "sync-crm-schema", "import-users"];
  const OPS = ["route-record", "bulk-route", "retry-failed", "toggle-routing"];
  const OPTIMIZE = ["rebalance-team", "update-rule-criteria", "reorder-rules", "clone-and-modify-rule"];
  if (SETUP.includes(tool)) return "setup";
  if (OPS.includes(tool)) return "operations";
  if (OPTIMIZE.includes(tool)) return "optimize";
  return "monitor";
}
