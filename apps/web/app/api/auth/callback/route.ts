import { NextRequest, NextResponse } from "next/server";

// Legacy callback URL — Salesforce Connected App still redirects here.
// Forward everything to the new /api/auth/sfdc/callback which properly
// associates the CRM with the already-logged-in user's org.
export async function GET(req: NextRequest) {
  // Use APP_URL as the base so the redirect stays on the public hostname.
  // req.url inside Docker uses the container's internal hostname (e.g.
  // http://8f1bd3f6d8b4:3000) which the browser cannot reach.
  const base = process.env.APP_URL ?? `http://localhost:3000`;
  const url = new URL("/api/auth/sfdc/callback", base);
  // Pass all query params (code, error, error_description, state) unchanged
  req.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });
  return NextResponse.redirect(url);
}
