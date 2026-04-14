import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getSession } from "@/lib/session";

/**
 * In-memory store for OAuth authorization codes.
 * Codes are short-lived (5 min) and single-use, consumed by the token endpoint.
 */
export interface StoredAuthCode {
  orgId: string;
  codeChallenge: string;
  redirectUri: string;
  clientId: string;
  expiresAt: number;
}

const authCodes = new Map<string, StoredAuthCode>();

// Periodic cleanup of expired codes (every 60s)
setInterval(() => {
  const now = Date.now();
  for (const [code, stored] of authCodes) {
    if (now > stored.expiresAt) authCodes.delete(code);
  }
}, 60_000);

/** Exported so the token endpoint can consume codes */
export { authCodes };

/**
 * GET /api/mcp-auth/authorize
 *
 * OAuth 2.1 authorization endpoint for MCP integrations.
 * If the user has an active session, issues an auth code and redirects back.
 * If not, redirects to login with a return URL.
 *
 * Query params:
 *  - client_id (required)
 *  - redirect_uri (required)
 *  - code_challenge (required, S256)
 *  - state (optional)
 *  - scope (optional)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const redirectUri = searchParams.get("redirect_uri");
  const state = searchParams.get("state");
  const codeChallenge = searchParams.get("code_challenge");
  const clientId = searchParams.get("client_id");

  if (!redirectUri || !codeChallenge || !clientId) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Missing required parameters: client_id, redirect_uri, code_challenge" },
      { status: 400 },
    );
  }

  // Validate redirect_uri — only allow known OAuth callbacks
  const ALLOWED_REDIRECT_PATTERNS = [
    "https://claude.ai/",
    "http://localhost:",
    "http://127.0.0.1:",
  ];
  const isAllowedRedirect = ALLOWED_REDIRECT_PATTERNS.some((p) => redirectUri.startsWith(p));
  if (!isAllowedRedirect) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "redirect_uri not allowed" },
      { status: 400 },
    );
  }

  // Check if user has an active session
  const session = await getSession();
  if (!session?.orgId) {
    // Redirect to login, preserving the full authorize URL as return target
    const returnUrl = req.nextUrl.toString();
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("next", returnUrl);
    console.log(`[MCP OAuth] No session, redirecting to login`);
    return NextResponse.redirect(loginUrl);
  }

  // Generate a cryptographically random authorization code
  const code = crypto.randomBytes(32).toString("hex");
  authCodes.set(code, {
    orgId: session.orgId,
    codeChallenge,
    redirectUri,
    clientId,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
  });

  console.log(`[MCP OAuth] Issued auth code for org=${session.orgId.slice(0, 8)}..., client=${clientId.slice(0, 8)}...`);

  // Redirect back to the caller with the authorization code
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);

  return NextResponse.redirect(url);
}
