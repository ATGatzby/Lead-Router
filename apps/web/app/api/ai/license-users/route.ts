import { NextRequest, NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { prisma } from "@lead-routing/db";
import { decryptField } from "@/lib/crypto";
import {
  buildLicenseSystemPrompt,
  validateLicenseResponse,
} from "@/lib/ai-license-prompt";
import type { AvailableUser } from "@/lib/ai-license-prompt";

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

    // ── Fetch available users ────────────────────────────────────────────
    const users: AvailableUser[] = await prisma.user.findMany({
      where: { orgId, isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        department: true,
        isLicensed: true,
      },
    });

    if (users.length === 0) {
      return NextResponse.json(
        {
          error:
            "No users found. Sync your Salesforce users first.",
        },
        { status: 400 },
      );
    }

    // ── Build system prompt ──────────────────────────────────────────────
    const systemPrompt = buildLicenseSystemPrompt(users);

    // ── Call AI provider ─────────────────────────────────────────────────
    const apiKey = decryptField(org.aiApiKey, APP_SECRET);
    let text: string;

    if (org.aiProvider === "claude") {
      text = await callClaude(apiKey, org.aiModelName, systemPrompt, description);
    } else if (org.aiProvider === "gemini") {
      text = await callGemini(apiKey, org.aiModelName, systemPrompt, description);
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
        "[AI License] Failed to parse AI response as JSON:",
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
      validated = validateLicenseResponse(parsed, users);
    } catch (err) {
      console.error("[AI License] Validation error:", err);
      return NextResponse.json(
        {
          error:
            "AI response did not match the expected format. Please try again.",
        },
        { status: 502 },
      );
    }

    return NextResponse.json(validated);
  } catch (err) {
    console.error("[AI License Error]", err);
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
    max_tokens: 2048,
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
    max_tokens: 2048,
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
