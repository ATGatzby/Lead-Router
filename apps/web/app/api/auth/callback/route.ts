import { NextRequest, NextResponse } from "next/server";

// GET /api/auth/callback — legacy redirect shim
// SFDC_REDIRECT_URI now points to /api/auth/sfdc/callback directly.
// This route is kept so any bookmarked or cached OAuth flows continue to work.
export async function GET(req: NextRequest) {
  const base = process.env.APP_URL ?? `http://localhost:3000`;
  const url = new URL("/api/auth/sfdc/callback", base);
  req.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });
  return NextResponse.redirect(url);
}
