import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getIronSession } from "iron-session";
import { prisma } from "@lead-routing/db";
import type { SessionData } from "@/lib/session";
import { isOrgSuspended } from "@/lib/org-status";

const SESSION_OPTIONS = {
  password: process.env.SESSION_SECRET!,
  cookieName: "lr_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 7,
  },
};

const PUBLIC_PREFIXES = [
  "/login",
  "/register",
  "/api/auth/",        // covers /api/auth/sfdc/ and /api/auth/hubspot/ OAuth flows
  "/api/cli-auth/",    // CLI OAuth bridge — request + poll endpoints (no user session)
  "/api/setup/",       // /api/setup/status + /api/setup/onboarding-done (Apex callouts, no session)
  "/api/fields/sync",  // Called by OnboardingController.syncFieldSchema — X-Sfdc-Org-Id auth
  "/_next/",
  "/favicon",
  "/suspended",
];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow static files and internals
  if (pathname.includes(".") || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  // Allow public paths
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  // Exact-match public paths (no prefix matching)
  if (pathname === "/api/health") {
    return NextResponse.next();
  }

  // ── Bearer token auth (API tokens for MCP / external clients) ────────────
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer lr_")) {
    const rawToken = authHeader.slice(7); // "lr_..."
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    const apiToken = await prisma.apiToken.findUnique({
      where: { tokenHash },
      select: { id: true, orgId: true, name: true, revokedAt: true, expiresAt: true },
    });

    if (!apiToken || apiToken.revokedAt) {
      return NextResponse.json({ error: "Invalid or revoked API token" }, { status: 401 });
    }
    if (apiToken.expiresAt && apiToken.expiresAt < new Date()) {
      return NextResponse.json({ error: "API token expired" }, { status: 401 });
    }

    // Update lastUsedAt (fire and forget)
    prisma.apiToken.update({
      where: { id: apiToken.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});

    // Check org suspension
    const suspended = await isOrgSuspended(apiToken.orgId);
    if (suspended) {
      return NextResponse.json({ error: "Organization is suspended" }, { status: 403 });
    }

    const safeHeader = (value: string): string => value.replace(/[\r\n]/g, "");
    const reqHeaders = new Headers(req.headers);
    reqHeaders.set("x-org-id", safeHeader(apiToken.orgId));
    reqHeaders.set("x-user-id", safeHeader(`api-token:${apiToken.id}`));
    reqHeaders.set("x-user-name", safeHeader(apiToken.name));

    return NextResponse.next({ request: { headers: reqHeaders } });
  }

  // CSRF: validate Origin for mutating requests on session-protected routes
  const method = req.method;
  if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
    const origin = req.headers.get("origin");
    const appUrl = process.env.APP_URL;
    if (origin && appUrl) {
      const allowed = new URL(appUrl).origin;
      if (origin !== allowed) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }

  // Decrypt session and inject headers for protected routes
  const res = NextResponse.next();
  const session = await getIronSession<SessionData>(req, res, SESSION_OPTIONS);

  // Check session existence and token age (30-day hard expiry)
  const MAX_SESSION_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
  const sessionExpired =
    !session.orgId ||
    (session.issuedAt != null &&
      Math.floor(Date.now() / 1000) - session.issuedAt > MAX_SESSION_AGE_SECONDS);

  if (sessionExpired) {
    if (session.orgId) await session.destroy(); // Clear stale session
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // ── Suspended org check ───────────────────────────────────────────────────
  const suspended = await isOrgSuspended(session.orgId);
  if (suspended) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Organization is suspended" }, { status: 403 });
    }
    if (!pathname.startsWith("/suspended")) {
      return NextResponse.redirect(new URL("/suspended", req.url));
    }
  }

  // Strip CR/LF from header values to prevent header injection
  const safeHeader = (value: string): string => value.replace(/[\r\n]/g, "");

  // Inject session fields as cheap headers for route handlers
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-org-id", safeHeader(session.orgId));
  reqHeaders.set("x-user-id", safeHeader(session.appUserId));   // AppUser.id (was x-sfdc-user-id)
  reqHeaders.set("x-user-name", safeHeader(session.userName));

  return NextResponse.next({
    request: { headers: reqHeaders },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
