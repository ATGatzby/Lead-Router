import { NextRequest, NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { prisma } from "@lead-routing/db";
import { encryptField, decryptField } from "@/lib/crypto";

const APP_SECRET = process.env.APP_SECRET ?? process.env.SESSION_SECRET!;

// GET — return current AI config (masked key)
export async function GET() {
  try {
    const orgId = await getOrgIdFromHeaders();
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: {
        aiProvider: true,
        aiModelName: true,
        aiBaseUrl: true,
        aiCustomHeaders: true,
        aiApiKey: true,
        aiChatCount: true,
      },
    });

    return NextResponse.json({
      provider: org.aiProvider,
      model: org.aiModelName,
      baseUrl: org.aiBaseUrl,
      customHeaders: org.aiCustomHeaders,
      hasKey: !!org.aiApiKey,
      chatCount: org.aiChatCount,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch AI settings" },
      { status: 500 }
    );
  }
}

// PUT — save AI config
export async function PUT(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();
    const body = await req.json();
    const { provider, apiKey, model, baseUrl, customHeaders } = body as {
      provider?: string;
      apiKey?: string;
      model?: string;
      baseUrl?: string;
      customHeaders?: Record<string, string>;
    };

    // Validate provider
    const validProviders = ["claude", "openai", "gemini", "custom"];
    if (provider && !validProviders.includes(provider)) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (provider !== undefined) data.aiProvider = provider;
    if (model !== undefined) data.aiModelName = model;
    if (baseUrl !== undefined) data.aiBaseUrl = baseUrl || null;
    if (customHeaders !== undefined) data.aiCustomHeaders = customHeaders || null;
    if (apiKey !== undefined) {
      data.aiApiKey = apiKey ? encryptField(apiKey, APP_SECRET) : null;
    }

    await prisma.organization.update({
      where: { id: orgId },
      data,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save AI settings" },
      { status: 500 }
    );
  }
}
