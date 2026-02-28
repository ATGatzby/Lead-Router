import { headers } from "next/headers";
import { requireSession } from "./session";

/**
 * Use in Server Components and Server Actions to get the current session.
 * Throws if not authenticated (middleware should have caught this first).
 */
export { requireSession };

/**
 * Use in Route Handlers — reads orgId injected by middleware.
 * Faster than parsing iron-session on every request.
 */
export async function getOrgIdFromHeaders(): Promise<string> {
  const hdrs = await headers();
  const orgId = hdrs.get("x-org-id");
  if (!orgId) throw new Error("Missing x-org-id header — middleware not running?");
  return orgId;
}

export async function getActorFromHeaders(): Promise<{
  orgId: string;
  userId: string;
  userName: string;
}> {
  const hdrs = await headers();
  const orgId = hdrs.get("x-org-id");
  const userId = hdrs.get("x-user-id");
  const userName = hdrs.get("x-user-name");
  if (!orgId || !userId || !userName) {
    throw new Error("Missing auth headers — middleware not running?");
  }
  return { orgId, userId, userName };
}
