import { NextResponse } from "next/server";

export async function GET() {
  // Dynamic import to avoid type-check dependency on @lead-routing/agent-api
  const { generateOpenAPISpec } = await import("@lead-routing/agent-api");
  const spec = generateOpenAPISpec();
  return NextResponse.json(spec, {
    headers: { "Access-Control-Allow-Origin": process.env.APP_URL || "https://localhost:3000" },
  });
}
