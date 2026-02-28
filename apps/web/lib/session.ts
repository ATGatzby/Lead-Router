import { getIronSession, IronSession } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  orgId: string;
  appUserId: string;  // AppUser.id (internal, not SFDC)
  userEmail: string;
  userName: string;
  role: string;       // "ADMIN" | "MEMBER"
  sfdcCodeVerifier?: string; // Temporary PKCE verifier — cleared after token exchange
}

const sessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: "lr_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

export async function requireSession(): Promise<SessionData> {
  const session = await getSession();
  if (!session.orgId) {
    throw new Error("Not authenticated");
  }
  return session as SessionData;
}
