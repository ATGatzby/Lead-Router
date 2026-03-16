import { NextRequest, NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { prisma } from "@lead-routing/db";
import { decryptField } from "@/lib/crypto";
import { TOOLS, toolsToOpenAI, executeTool, getToolsForContext } from "@/lib/ai/tools";
import { composeSystemPrompt } from "@/lib/ai/prompts";
import type { AgentContext } from "@/lib/ai/contexts";

const APP_SECRET = process.env.APP_SECRET ?? process.env.SESSION_SECRET!;

const SYSTEM_PROMPT = `You are an AI assistant for Lead Router, a lead routing platform for Salesforce.
You help users analyze their lead routing data, understand rule performance, detect anomalies, and optimize their routing configuration.

Guidelines:
- Use the provided tools to query the database. Never make up data.
- All data is scoped to the user's organization automatically.
- Format numbers with commas (e.g., 1,247). Format percentages to 1 decimal place.
- When showing tabular data, use markdown tables.
- When you spot issues (high failure rates, workload imbalance, anomalies), proactively suggest fixes.
- Be concise but thorough. Lead with the answer, then provide context.
- Dates are in the user's timezone unless specified. Today is ${new Date().toISOString().split("T")[0]}.
- IMPORTANT: When querying data, do NOT add date filters unless the user explicitly asks for a specific time range. Omitting dateFrom/dateTo returns ALL-TIME data, which is usually what the user wants. Only add date filters when the user says things like "last 30 days", "this month", "since January", etc.

Charts & Visualizations:
When a chart would help the user understand data better (trends, comparisons, distributions), output a fenced code block with language "chart" containing a JSON spec. The frontend will render it as an interactive chart. Use charts proactively when showing trends, comparisons, or distributions — don't wait to be asked.

Chart spec format:
\`\`\`chart
{"type":"bar|line|area|pie","title":"Chart Title","data":[{"label":"A","value":10},...],"xKey":"label","yKeys":["value"],"stacked":false}
\`\`\`

Rules:
- type: "bar" for comparisons, "line" for trends over time, "area" for volume over time, "pie" for proportions
- data: array of objects with consistent keys
- xKey: the key used for labels/x-axis
- yKeys: array of keys for values (multiple for grouped/stacked charts)
- stacked: optional, true for stacked bar/area charts
- Always include a descriptive title
- Keep data labels short (truncate rule names, abbreviate dates like "Mar 1")
- Add a brief text summary before or after the chart for context`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: {
        plan: true,
        aiProvider: true,
        aiApiKey: true,
        aiModelName: true,
        aiBaseUrl: true,
        aiCustomHeaders: true,
      },
    });

    if (org.plan !== "PAID") {
      return NextResponse.json(
        { error: "AI Assistant requires a Pro plan" },
        { status: 403 }
      );
    }

    if (!org.aiProvider || !org.aiApiKey) {
      return NextResponse.json(
        { error: "AI provider not configured" },
        { status: 400 }
      );
    }

    const apiKey = decryptField(org.aiApiKey, APP_SECRET);
    const body = await req.json();
    const messages: ChatMessage[] = body.messages ?? [];
    const modelOverride: string | undefined = body.model;
    const context: AgentContext = body.context ?? "global";

    const systemPrompt = await composeSystemPrompt(orgId, context);
    const contextTools = getToolsForContext(context);

    // Route to the correct provider
    let responseText: string;
    if (org.aiProvider === "claude") {
      responseText = await handleClaude(apiKey, modelOverride ?? org.aiModelName, messages, orgId, contextTools, systemPrompt);
    } else if (org.aiProvider === "gemini") {
      responseText = await handleGemini(apiKey, modelOverride ?? org.aiModelName, messages, orgId, contextTools, systemPrompt);
    } else {
      // openai or custom
      responseText = await handleOpenAI(
        apiKey,
        modelOverride ?? org.aiModelName,
        messages,
        orgId,
        org.aiBaseUrl,
        org.aiCustomHeaders as Record<string, string> | null,
        contextTools,
        systemPrompt
      );
    }

    // Increment chat count
    await prisma.organization.update({
      where: { id: orgId },
      data: { aiChatCount: { increment: 1 } },
    });

    return NextResponse.json({ role: "assistant", content: responseText });
  } catch (err) {
    console.error("[AI Chat Error]", err);
    const message = err instanceof Error ? err.message : "Chat request failed";
    const isTimeout = message.includes("timed out") || message.includes("ECONNREFUSED") || message.includes("ETIMEDOUT");
    return NextResponse.json(
      {
        error: isTimeout
          ? "Request timed out. If using a self-hosted model, ensure the endpoint is reachable from the server (not localhost)."
          : message,
      },
      { status: isTimeout ? 504 : 500 }
    );
  }
}

// ─── Claude handler ───────────────────────────────────────────────────────────

async function handleClaude(
  apiKey: string,
  model: string | null,
  messages: ChatMessage[],
  orgId: string,
  tools: any[],
  systemPrompt: string
): Promise<string> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey });

  const claudeMessages = messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  let response = await client.messages.create({
    model: model ?? "claude-sonnet-4-5-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    messages: claudeMessages,
    tools: tools as any,
  });

  // Tool use loop
  while (response.stop_reason === "tool_use") {
    const toolBlocks = response.content.filter((b): b is any => b.type === "tool_use");
    const toolResults: any[] = [];

    for (const block of toolBlocks) {
      try {
        const result = await executeTool(block.name, block.input as Record<string, unknown>, orgId);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify({ error: err instanceof Error ? err.message : "Tool execution failed" }),
          is_error: true,
        });
      }
    }

    response = await client.messages.create({
      model: model ?? "claude-sonnet-4-5-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        ...claudeMessages,
        { role: "assistant", content: response.content },
        { role: "user", content: toolResults },
      ],
      tools: tools as any,
    });
  }

  // Extract text from response
  const textBlocks = response.content.filter((b): b is any => b.type === "text");
  return textBlocks.map((b) => b.text).join("\n");
}

// ─── OpenAI / Custom handler ──────────────────────────────────────────────────

async function handleOpenAI(
  apiKey: string,
  model: string | null,
  messages: ChatMessage[],
  orgId: string,
  baseUrl: string | null,
  customHeaders: Record<string, string> | null,
  tools: any[],
  systemPrompt: string
): Promise<string> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({
    apiKey,
    ...(baseUrl && { baseURL: baseUrl }),
    ...(customHeaders && { defaultHeaders: customHeaders }),
    timeout: 120_000, // 2 min timeout for custom/self-hosted models
  });

  const openaiMessages: any[] = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  let response = await client.chat.completions.create({
    model: model ?? "gpt-4o",
    max_tokens: 4096,
    messages: openaiMessages,
    tools: toolsToOpenAI(tools),
  });

  // Tool use loop
  while (response.choices[0]?.finish_reason === "tool_calls") {
    const toolCalls = response.choices[0].message.tool_calls ?? [];
    openaiMessages.push(response.choices[0].message);

    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      try {
        const args = JSON.parse(call.function.arguments);
        const result = await executeTool(call.function.name, args, orgId);
        openaiMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      } catch (err) {
        openaiMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ error: err instanceof Error ? err.message : "Tool execution failed" }),
        });
      }
    }

    response = await client.chat.completions.create({
      model: model ?? "gpt-4o",
      max_tokens: 4096,
      messages: openaiMessages,
      tools: toolsToOpenAI(tools),
    });
  }

  return response.choices[0]?.message?.content ?? "";
}

// ─── Gemini handler ───────────────────────────────────────────────────────────

async function handleGemini(
  apiKey: string,
  model: string | null,
  messages: ChatMessage[],
  orgId: string,
  tools: any[],
  systemPrompt: string
): Promise<string> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  // Build Gemini tool declarations (cast to any — Gemini SDK expects its own Type enum for schema types)
  const geminiTools: any[] = [{
    functionDeclarations: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema as any,
    })),
  }];

  // Build contents from messages
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  let response = await ai.models.generateContent({
    model: model ?? "gemini-2.5-flash",
    contents,
    config: {
      systemInstruction: systemPrompt,
      tools: geminiTools,
    },
  });

  // Tool use loop
  let maxIterations = 10;
  while (maxIterations-- > 0) {
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const functionCalls = parts.filter((p: any) => p.functionCall);

    if (functionCalls.length === 0) break;

    const functionResponses: any[] = [];
    for (const part of functionCalls) {
      const fc = (part as any).functionCall;
      try {
        const result = await executeTool(fc.name, fc.args ?? {}, orgId);
        functionResponses.push({
          functionResponse: {
            name: fc.name,
            response: { result },
          },
        });
      } catch (err) {
        functionResponses.push({
          functionResponse: {
            name: fc.name,
            response: { error: err instanceof Error ? err.message : "Tool execution failed" },
          },
        });
      }
    }

    // Add model response + tool results to conversation
    contents.push(
      { role: "model", parts: parts as any },
      { role: "user", parts: functionResponses }
    );

    response = await ai.models.generateContent({
      model: model ?? "gemini-2.5-flash",
      contents,
      config: {
        systemInstruction: systemPrompt,
        tools: geminiTools,
      },
    });
  }

  // Extract text
  const textParts = response.candidates?.[0]?.content?.parts?.filter((p: any) => p.text) ?? [];
  return textParts.map((p: any) => p.text).join("\n");
}
