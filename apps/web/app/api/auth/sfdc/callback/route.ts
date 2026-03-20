import { NextRequest, NextResponse } from "next/server";
import {
  MANAGED_PACKAGE_CLIENT_ID,
  OAUTH_REDIRECT_URL,
  exchangeCodeForTokens,
  createConnection,
  pushSettings,
  syncFieldSchema,
} from "@lead-routing/sfdc";
import { prisma } from "@lead-routing/db";
import { getSession } from "@/lib/session";
import { completeCliAuthSession, getCliAuthCodeVerifier } from "@/lib/cli-auth-store";

/**
 * Parse the state parameter which may be a compound base64url-encoded JSON
 * from the central redirect service: { targetUrl, originalState }
 * Or it may be a plain string (legacy / direct callback).
 */
function parseState(raw: string): { originalState: string; isCompound: boolean } {
  try {
    const decoded = JSON.parse(Buffer.from(raw, "base64url").toString());
    if (decoded && typeof decoded === "object" && decoded.targetUrl) {
      return { originalState: decoded.originalState ?? "", isCompound: true };
    }
  } catch {
    // Not base64url JSON — treat as plain state
  }
  return { originalState: raw, isCompound: false };
}

// CLI flow still uses server-side token exchange (exchangeCodeForTokens).
// Web flow uses client-side token exchange (browser → Salesforce) to avoid server IP restrictions.

// GET /api/auth/sfdc/callback — called by Salesforce after OAuth consent
//
// Two flows share this URL (SFDC_REDIRECT_URI points here):
//
// 1. CLI bridge flow (state starts with "cli:" or compound state with originalState starting with "cli:"):
//    The CLI starts a session via POST /api/cli-auth/request, opens the
//    Salesforce auth URL in the browser, then polls /api/cli-auth/poll/:sessionId.
//    We exchange the code for tokens here and store them so the CLI can collect
//    them without needing an authenticated web session.
//
// 2. Normal web app flow (any other state):
//    Associates the SFDC org with the already-logged-in user's org via iron-session.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const rawState = searchParams.get("state") ?? "";
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  // Decode compound state from the redirect service if present
  const { originalState: state } = parseState(rawState);

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  // ── CLI bridge flow ────────────────────────────────────────────────────────
  if (state.startsWith("cli:") && code) {
    const sessionId = state.slice(4);
    const loginUrl =
      process.env.SFDC_LOGIN_URL ?? "https://login.salesforce.com";

    const codeVerifier = getCliAuthCodeVerifier(sessionId);

    const bodyParams: Record<string, string> = {
      grant_type: "authorization_code",
      code,
      client_id: MANAGED_PACKAGE_CLIENT_ID,
      redirect_uri: OAUTH_REDIRECT_URL,
    };
    // Only include client_secret if set (backward compat — PKCE doesn't need it)
    if (process.env.SFDC_CLIENT_SECRET) {
      bodyParams.client_secret = process.env.SFDC_CLIENT_SECRET;
    }
    if (codeVerifier) {
      bodyParams.code_verifier = codeVerifier;
    }

    const body = new URLSearchParams(bodyParams);

    try {
      const tokenRes = await fetch(`${loginUrl}/services/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        console.error("[cli-auth] Token exchange failed:", errText);
        return new Response(
          cliResultHtml(false, "Token exchange failed. Please close this tab and try again."),
          { headers: { "Content-Type": "text/html" } }
        );
      }

      const data = (await tokenRes.json()) as {
        access_token: string;
        instance_url: string;
      };

      completeCliAuthSession(sessionId, data.access_token, data.instance_url);

      return new Response(cliResultHtml(true), {
        headers: { "Content-Type": "text/html" },
      });
    } catch (err) {
      console.error("[cli-auth] Callback error:", err);
      return new Response(
        cliResultHtml(false, "Authentication failed. Please close this tab and try again."),
        { headers: { "Content-Type": "text/html" } }
      );
    }
  }

  // ── Normal web app flow ────────────────────────────────────────────────────
  if (error || !code) {
    const desc = searchParams.get("error_description") ?? "OAuth failed";
    return NextResponse.redirect(
      new URL(`/dashboard?crm_error=${encodeURIComponent(desc)}`, appUrl)
    );
  }

  try {
    const session = await getSession();
    if (!session.orgId) throw new Error("Not authenticated");

    // Validate OAuth state parameter (CSRF protection)
    // Compare against the original (non-compound) state stored in cookie
    const savedState = req.cookies.get("sfdc_oauth_state")?.value;
    if (!state || !savedState || state !== savedState) {
      return NextResponse.json({ error: "Invalid OAuth state" }, { status: 403 });
    }

    const codeVerifier = req.cookies.get("sfdc_pkce_verifier")?.value;

    const { tokens, orgId: sfdcOrgId } = await exchangeCodeForTokens(code, codeVerifier);

    // Check this SFDC org isn't already connected to a different account
    const conflict = await prisma.organization.findUnique({
      where: { sfdcOrgId },
      select: { id: true },
    });
    if (conflict && conflict.id !== session.orgId) {
      return NextResponse.redirect(
        new URL("/dashboard?crm_error=This+Salesforce+org+is+already+connected+to+another+account", appUrl)
      );
    }

    const org = await prisma.organization.update({
      where: { id: session.orgId },
      data: {
        sfdcOrgId,
        sfdcInstanceUrl: tokens.instanceUrl,
        oauthAccessToken: tokens.accessToken,
        oauthRefreshToken: tokens.refreshToken,
      },
      select: { webhookSecret: true },
    });

    const conn = createConnection(tokens);

    if (org.webhookSecret) {
      pushSettings(conn, {
        webhookSecret: org.webhookSecret,
        engineUrl: process.env.PUBLIC_ENGINE_URL ?? process.env.ENGINE_URL ?? "http://localhost:3001",
        appUrl: process.env.APP_URL ?? "http://localhost:3000",
      }).catch((err) => console.error("[sfdc-callback] pushSettings failed:", err));
    }

    // Sync field schemas for all supported objects so condition builder is ready immediately
    Promise.all(
      ["Lead", "Contact", "Account"].map((obj) =>
        syncFieldSchema(conn, session.orgId!, obj).catch((err) =>
          console.error(`[sfdc-callback] syncFieldSchema(${obj}) failed:`, err)
        )
      )
    );

    const successRedirect = NextResponse.redirect(new URL("/integrations/salesforce?connected=1", appUrl));
    successRedirect.cookies.delete("sfdc_pkce_verifier");
    successRedirect.cookies.delete("sfdc_oauth_state");
    return successRedirect;
  } catch (err) {
    console.error("SFDC OAuth callback error:", err);
    return NextResponse.redirect(
      new URL("/dashboard?crm_error=Connection+failed", appUrl)
    );
  }
}

function cliResultHtml(success: boolean, message?: string): string {
  const icon = success ? "✓" : "✗";
  const heading = success ? "Authenticated" : "Error";
  const body = success
    ? "You may close this tab and return to your terminal."
    : (message ?? "Something went wrong.");
  const color = success ? "#22c55e" : "#ef4444";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${success ? "Authentication Complete" : "Authentication Failed"}</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center;
           justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: #fff; padding: 2rem; border-radius: 12px;
            box-shadow: 0 2px 12px rgba(0,0,0,.1); text-align: center; max-width: 380px; }
    h1 { margin: 0 0 .5rem; font-size: 1.5rem; color: ${color}; }
    p { color: #555; margin: 0; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${icon} ${heading}</h1>
    <p>${body}</p>
  </div>
</body>
</html>`;
}
