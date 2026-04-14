import { NextResponse } from "next/server";
import { generateOpenAPISpec } from "@lead-routing/agent-api";

export async function GET() {
  const spec = generateOpenAPISpec();
  return NextResponse.json(spec, {
    headers: { "Access-Control-Allow-Origin": process.env.APP_URL || "https://localhost:3000" },
  });
}
