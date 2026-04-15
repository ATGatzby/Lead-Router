import { NextResponse } from "next/server";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — workspace package resolved by pnpm/bundler, may fail standalone tsc
import { generateOpenAPISpec } from "@lead-routing/agent-api";

export async function GET() {
  const spec = generateOpenAPISpec();
  return NextResponse.json(spec, {
    headers: { "Access-Control-Allow-Origin": process.env.APP_URL || "https://localhost:3000" },
  });
}
