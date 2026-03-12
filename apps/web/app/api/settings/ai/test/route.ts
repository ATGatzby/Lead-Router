import { NextRequest, NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { prisma } from "@lead-routing/db";
import { decryptField } from "@/lib/crypto";

const APP_SECRET = process.env.APP_SECRET ?? process.env.SESSION_SECRET!;

// POST — test connection to configured AI provider
export async function POST(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();
    const body = await req.json();
    const { provider, apiKey, model, baseUrl } = body as {
      provider: string;
      apiKey: string;
      model?: string;
      baseUrl?: string;
    };

    const start = Date.now();

    if (provider === "claude") {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey });
      await client.messages.create({
        model: model ?? "claude-sonnet-4-5-20250514",
        max_tokens: 10,
        messages: [{ role: "user", content: "Say ok" }],
      });
    } else if (provider === "openai" || provider === "custom") {
      const OpenAI = (await import("openai")).default;
      const client = new OpenAI({
        apiKey,
        ...(baseUrl && { baseURL: baseUrl }),
      });
      await client.chat.completions.create({
        model: model ?? "gpt-4o",
        max_tokens: 10,
        messages: [{ role: "user", content: "Say ok" }],
      });
    } else if (provider === "gemini") {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey });
      await ai.models.generateContent({
        model: model ?? "gemini-2.5-flash",
        contents: "Say ok",
      });
    } else {
      return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
    }

    const latencyMs = Date.now() - start;
    return NextResponse.json({ ok: true, latencyMs });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Connection failed" },
      { status: 400 }
    );
  }
}
