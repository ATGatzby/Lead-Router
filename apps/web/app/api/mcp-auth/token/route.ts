import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@lead-routing/db";
import { authCodes } from "../authorize/route";

/**
 * POST /api/mcp-auth/token
 *
 * OAuth 2.1 token endpoint for MCP integrations.
 * Exchanges an authorization code (with PKCE verification) for an API token.
 *
 * Accepts application/x-www-form-urlencoded or application/json.
 */
export async function POST(req: NextRequest) {
  // Parse body — support both form-encoded and JSON
  let grantType: string | null = null;
  let code: string | null = null;
  let codeVerifier: string | null = null;
  let clientId: string | null = null;

  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await req.formData();
    grantType = formData.get("grant_type") as string | null;
    code = formData.get("code") as string | null;
    codeVerifier = formData.get("code_verifier") as string | null;
    clientId = formData.get("client_id") as string | null;
  } else {
    try {
      const body = await req.json();
      grantType = body.grant_type ?? null;
      code = body.code ?? null;
      codeVerifier = body.code_verifier ?? null;
      clientId = body.client_id ?? null;
    } catch {
      return NextResponse.json(
        { error: "invalid_request", error_description: "Could not parse request body" },
        { status: 400 },
      );
    }
  }

  // Validate grant type
  if (grantType !== "authorization_code") {
    return NextResponse.json(
      { error: "unsupported_grant_type", error_description: "Only authorization_code is supported" },
      { status: 400 },
    );
  }

  if (!code || !codeVerifier || !clientId) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Missing required parameters: code, code_verifier, client_id" },
      { status: 400 },
    );
  }

  // Look up the stored authorization code
  const stored = authCodes.get(code);
  if (!stored) {
    return NextResponse.json(
      { error: "invalid_grant", error_description: "Authorization code not found or already used" },
      { status: 400 },
    );
  }

  // Check expiry
  if (Date.now() > stored.expiresAt) {
    authCodes.delete(code);
    return NextResponse.json(
      { error: "invalid_grant", error_description: "Authorization code expired" },
      { status: 400 },
    );
  }

  // Verify client_id matches
  const clientMatch = clientId.length === stored.clientId.length &&
    crypto.timingSafeEqual(Buffer.from(clientId), Buffer.from(stored.clientId));
  if (!clientMatch) {
    authCodes.delete(code);
    console.error(`[MCP OAuth] Client ID mismatch: expected=${stored.clientId}, got=${clientId}`);
    return NextResponse.json(
      { error: "invalid_client", error_description: "Client ID does not match" },
      { status: 400 },
    );
  }

  // PKCE S256 verification
  const expectedChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  const challengeMatch = expectedChallenge.length === stored.codeChallenge.length &&
    crypto.timingSafeEqual(Buffer.from(expectedChallenge), Buffer.from(stored.codeChallenge));
  if (!challengeMatch) {
    authCodes.delete(code);
    console.error(`[MCP OAuth] PKCE verification failed for client=${clientId}`);
    return NextResponse.json(
      { error: "invalid_grant", error_description: "PKCE verification failed" },
      { status: 400 },
    );
  }

  // Consume the code (single-use)
  authCodes.delete(code);

  // Create a real API token for this org
  const rawToken = `lr_${crypto.randomBytes(20).toString("hex")}`;
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const prefix = rawToken.slice(0, 8);

  try {
    await prisma.apiToken.create({
      data: {
        orgId: stored.orgId,
        name: `MCP OAuth (${clientId.slice(0, 8)})`,
        tokenHash,
        prefix,
        scopes: ["read", "route", "agent"],
      },
    });

    console.log(`[MCP OAuth] Created API token for org=${stored.orgId}, client=${clientId.slice(0, 8)}`);

    return NextResponse.json({
      access_token: rawToken,
      token_type: "bearer",
      expires_in: 86400 * 365, // 1 year (token doesn't truly expire unless revoked)
      scope: "read route agent",
    });
  } catch (err) {
    console.error("[MCP OAuth] Failed to create API token:", err);
    return NextResponse.json(
      { error: "server_error", error_description: "Failed to create access token" },
      { status: 500 },
    );
  }
}
