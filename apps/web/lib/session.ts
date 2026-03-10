import { getIronSession, IronSession } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  orgId: string;
  appUserId: string;  // AppUser.id (internal, not SFDC)
  userEmail: string;
  userName: string;
  role: string;       // "ADMIN" | "MEMBER"
  issuedAt?: number;  // Unix timestamp (seconds) — used for token age check
  sfdcCodeVerifier?: string; // Temporary PKCE verifier — cleared after token exchange
  sfdcOauthState?: string;   // CSRF protection for OAuth flow
}

const sessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: "lr_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

const MAX_SESSION_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export async function requireSession(): Promise<SessionData> {
  const session = await getSession();
  if (!session.orgId) {
    throw new Error("Not authenticated");
  }
  // Enforce maximum token age (30 days) even if cookie hasn't expired
  if (session.issuedAt) {
    const age = Math.floor(Date.now() / 1000) - session.issuedAt;
    if (age > MAX_SESSION_AGE_SECONDS) {
      session.destroy();
      throw new Error("Session expired");
    }
  }
  return session as SessionData;
}
