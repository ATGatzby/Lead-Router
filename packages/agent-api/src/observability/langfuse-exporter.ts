import { Langfuse } from "langfuse";

let langfuseClient: Langfuse | null = null;

function getClient(): Langfuse | null {
  if (!process.env.LANGFUSE_ENABLED || process.env.LANGFUSE_ENABLED !== "true") return null;

  if (!langfuseClient) {
    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = process.env.LANGFUSE_SECRET_KEY;
    const baseUrl = process.env.LANGFUSE_URL || "http://langfuse:3000";

    if (!publicKey || !secretKey) return null;

    langfuseClient = new Langfuse({
      publicKey,
      secretKey,
      baseUrl,
      flushAt: 1,        // flush immediately — don't batch
      flushInterval: 500, // or flush every 500ms
    });
  }
  return langfuseClient;
}

export async function exportToLangfuse(data: {
  tool: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  durationMs: number;
  status: "success" | "error" | "rate_limited";
  errorCode?: string;
  orgId: string;
  tokenId: string;
  crmType: string;
  category: string;
  warnings?: string[];
}) {
  try {
    const client = getClient();
    if (!client) return;

    const trace = client.trace({
      name: `agent.${data.tool}`,
      userId: data.tokenId,
      sessionId: data.orgId,
      input: data.input,
      output: data.output,
      metadata: {
        category: data.category,
        crmType: data.crmType,
        warnings: data.warnings,
        status: data.status,
        errorCode: data.errorCode,
      },
      tags: [data.status, data.category, data.crmType],
    });

    trace.span({
      name: data.tool,
      input: data.input,
      output: data.output,
      startTime: new Date(Date.now() - data.durationMs),
      endTime: new Date(),
      statusMessage: data.status === "error" ? data.errorCode : undefined,
      metadata: { responseSize: JSON.stringify(data.output).length },
    });

    // Flush immediately — Next.js may not keep the process alive long enough for batching
    await client.flushAsync();
  } catch (err: unknown) {
    // Fire-and-forget — never break the API
    console.error("Langfuse export failed:", err);
  }
}

export async function shutdownLangfuse() {
  if (langfuseClient) {
    await langfuseClient.shutdownAsync();
    langfuseClient = null;
  }
}
