import { NextRequest, NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { prisma } from "@lead-routing/db";
import { decryptField } from "@/lib/crypto";
import {
  buildRouteSystemPrompt,
  validateRouteResponse,
  mapRouteResponseToBuilderState,
  type Assignee,
} from "@/lib/ai-route-prompt";
import type { FieldSchema } from "@/components/condition-builder/types";

const APP_SECRET = process.env.APP_SECRET ?? process.env.SESSION_SECRET!;

export async function POST(req: NextRequest) {
  // ── Kill switch ──────────────────────────────────────────────────────────
  if (process.env.NEXT_PUBLIC_ENABLE_AI_GENERATOR !== "true") {
    return new Response("Not Found", { status: 404 });
  }

  try {
    // ── Auth ──────────────────────────────────────────────────────────────
    const orgId = await getOrgIdFromHeaders();

    // ── Fetch org AI config ──────────────────────────────────────────────
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

    if (!org.aiProvider || !org.aiApiKey) {
      return NextResponse.json(
        {
          error:
            "AI provider not configured. Go to Settings \u2192 AI to set up your provider.",
        },
        { status: 400 },
      );
    }

    // ── Parse request body ───────────────────────────────────────────────
    const body = await req.json();
    const description: string = body.description;
    if (
      !description ||
      typeof description !== "string" ||
      description.trim().length === 0
    ) {
      return NextResponse.json(
        { error: "description is required" },
        { status: 400 },
      );
    }

    // ── Fetch fields for ALL object types ────────────────────────────────
    const [leadFields, contactFields, accountFields] = await Promise.all([
      prisma.fieldSchema.findMany({
        where: { orgId, objectType: "LEAD" },
        select: {
          fieldApiName: true,
          fieldLabel: true,
          fieldType: true,
          picklistValues: true,
        },
      }),
      prisma.fieldSchema.findMany({
        where: { orgId, objectType: "CONTACT" },
        select: {
          fieldApiName: true,
          fieldLabel: true,
          fieldType: true,
          picklistValues: true,
        },
      }),
      prisma.fieldSchema.findMany({
        where: { orgId, objectType: "ACCOUNT" },
        select: {
          fieldApiName: true,
          fieldLabel: true,
          fieldType: true,
          picklistValues: true,
        },
      }),
    ]);

    // Need at least one object type with fields
    if (
      leadFields.length === 0 &&
      contactFields.length === 0 &&
      accountFields.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "No fields synced for any object type. Go to Settings \u2192 Fields and sync your Salesforce fields first.",
        },
        { status: 400 },
      );
    }

    // ── Fetch assignees ──────────────────────────────────────────────────
    const [usersRaw, teamsRaw, queuesRaw] = await Promise.all([
      prisma.user.findMany({
        where: { orgId, isActive: true },
        select: { id: true, name: true },
      }),
      prisma.roundRobinTeam.findMany({
        where: { orgId },
        select: { id: true, name: true },
      }),
      prisma.sfdcQueue.findMany({
        where: { orgId },
        select: { id: true, name: true },
      }),
    ]);

    const users: Assignee[] = usersRaw.map((u: { id: string; name: string }) => ({
      id: u.id,
      name: u.name,
      type: "user" as const,
    }));
    const teams: Assignee[] = teamsRaw.map((t: { id: string; name: string }) => ({
      id: t.id,
      name: t.name,
      type: "team" as const,
    }));
    const queues: Assignee[] = queuesRaw.map((q: { id: string; name: string }) => ({
      id: q.id,
      name: q.name,
      type: "queue" as const,
    }));

    // ── Build field maps ─────────────────────────────────────────────────
    const castFields = (
      raw: typeof leadFields,
    ): FieldSchema[] =>
      raw.map((f) => ({
        id: "",
        fieldApiName: f.fieldApiName,
        fieldLabel: f.fieldLabel,
        fieldType: f.fieldType as any,
        picklistValues: (f.picklistValues as string[] | null) ?? null,
      }));

    const fieldsByObject: Record<string, FieldSchema[]> = {};
    if (leadFields.length > 0) fieldsByObject.LEAD = castFields(leadFields);
    if (contactFields.length > 0)
      fieldsByObject.CONTACT = castFields(contactFields);
    if (accountFields.length > 0)
      fieldsByObject.ACCOUNT = castFields(accountFields);

    // ── Build system prompt ──────────────────────────────────────────────
    const systemPrompt = buildRouteSystemPrompt(
      fieldsByObject,
      users,
      teams,
      queues,
    );

    // ── Call AI provider ─────────────────────────────────────────────────
    const apiKey = decryptField(org.aiApiKey, APP_SECRET);
    let text: string;

    if (org.aiProvider === "claude") {
      text = await callClaude(
        apiKey,
        org.aiModelName,
        systemPrompt,
        description,
      );
    } else if (org.aiProvider === "gemini") {
      text = await callGemini(
        apiKey,
        org.aiModelName,
        systemPrompt,
        description,
      );
    } else {
      // openai or custom
      text = await callOpenAI(
        apiKey,
        org.aiModelName,
        systemPrompt,
        description,
        org.aiBaseUrl,
        org.aiCustomHeaders as Record<string, string> | null,
      );
    }

    // ── Parse and validate response ──────────────────────────────────────
    const jsonStr = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error(
        "[AI Route] Failed to parse AI response as JSON:",
        text.slice(0, 500),
      );
      return NextResponse.json(
        {
          error:
            "AI returned an invalid response. Please try rephrasing your description.",
        },
        { status: 502 },
      );
    }

    let validated;
    try {
      validated = validateRouteResponse(
        parsed,
        fieldsByObject,
        users,
        teams,
        queues,
      );
    } catch (err) {
      console.error("[AI Route] Validation error:", err);
      return NextResponse.json(
        {
          error:
            "AI response did not match the expected format. Please try again.",
        },
        { status: 502 },
      );
    }

    // ── Convert to RouteBuilderState ─────────────────────────────────────
    const builderState = mapRouteResponseToBuilderState(
      validated,
      users,
      teams,
      queues,
    );

    return NextResponse.json({
      routeState: builderState,
      enhancedPrompt: validated.enhanced?.prompt ?? "",
      confidence: validated.confidence,
      warnings: validated.warnings ?? [],
    });
  } catch (err) {
    console.error("[AI Route Error]", err);
    const message = err instanceof Error ? err.message : "Request failed";
    const isAuth =
      message.includes("x-org-id") || message.includes("middleware");
    const isTimeout =
      message.includes("timed out") ||
      message.includes("ECONNREFUSED") ||
      message.includes("ETIMEDOUT");
    if (isAuth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      {
        error: isTimeout
          ? "Request timed out. If using a self-hosted model, ensure the endpoint is reachable."
          : message,
      },
      { status: isTimeout ? 504 : 500 },
    );
  }
}

// ─── Claude ──────────────────────────────────────────────────────────────────

async function callClaude(
  apiKey: string,
  model: string | null,
  systemPrompt: string,
  description: string,
): Promise<string> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: model ?? "claude-sonnet-4-5-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: description }],
  });

  return response.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");
}

// ─── OpenAI / Custom ────────────────────────────────────────────────────────

async function callOpenAI(
  apiKey: string,
  model: string | null,
  systemPrompt: string,
  description: string,
  baseUrl: string | null,
  customHeaders: Record<string, string> | null,
): Promise<string> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({
    apiKey,
    ...(baseUrl && { baseURL: baseUrl }),
    ...(customHeaders && { defaultHeaders: customHeaders }),
    timeout: 120_000,
  });

  const response = await client.chat.completions.create({
    model: model ?? "gpt-4o",
    max_tokens: 4096,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: description },
    ],
  });

  return response.choices[0]?.message?.content ?? "";
}

// ─── Gemini ──────────────────────────────────────────────────────────────────

async function callGemini(
  apiKey: string,
  model: string | null,
  systemPrompt: string,
  description: string,
): Promise<string> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: model ?? "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: description }] }],
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json",
    },
  });

  return (
    response.candidates?.[0]?.content?.parts
      ?.filter((p: any) => p.text)
      .map((p: any) => p.text)
      .join("") ?? ""
  );
}
