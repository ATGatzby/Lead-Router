import { NextRequest, NextResponse } from "next/server";
import { completeCliAuthSession } from "@/lib/cli-auth-store";

// Salesforce OAuth callback — two flows share this URL:
//
// 1. CLI bridge flow (state starts with "cli:"):
//    The CLI starts a session via POST /api/cli-auth/request, opens this URL
//    in the browser, then polls /api/cli-auth/poll/:sessionId. We exchange the
//    code for tokens here and store them in the in-memory store so the CLI can
//    collect them without needing an authenticated web session.
//
// 2. Normal web app flow (any other state):
//    Forward to /api/auth/sfdc/callback which associates SFDC with the
//    logged-in user's org via iron-session.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const state = searchParams.get("state") ?? "";
  const code = searchParams.get("code");

  // ── CLI bridge flow ────────────────────────────────────────────────────────
  if (state.startsWith("cli:") && code) {
    const sessionId = state.slice(4);
    const loginUrl =
      process.env.SFDC_LOGIN_URL ?? "https://login.salesforce.com";

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: process.env.SFDC_CLIENT_ID ?? "",
      client_secret: process.env.SFDC_CLIENT_SECRET ?? "",
      redirect_uri: process.env.SFDC_REDIRECT_URI ?? "",
    });

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
