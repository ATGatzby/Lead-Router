interface CliAuthEntry {
  status: "pending" | "ok";
  accessToken?: string;
  refreshToken?: string;
  instanceUrl?: string;
  sfdcOrgId?: string;
  codeVerifier?: string;
  expiresAt: number;
}

// Module-level in-memory store — suitable for single-process self-hosted deployment.
// TTL: 10 minutes. Consumed and deleted on first successful poll.
const store = new Map<string, CliAuthEntry>();

export function createCliAuthSession(sessionId: string, codeVerifier: string): void {
  const now = Date.now();
  // Prune expired sessions
  for (const [k, v] of store) {
    if (v.expiresAt < now) store.delete(k);
  }
  store.set(sessionId, {
    status: "pending",
    codeVerifier,
    expiresAt: now + 10 * 60 * 1000,
  });
}

export function getCliAuthCodeVerifier(sessionId: string): string | undefined {
  return store.get(sessionId)?.codeVerifier;
}

/**
 * Mark a CLI auth session as successfully authenticated.
 * The CLI polls /api/cli-auth/poll/:sessionId and receives all four fields
 * (accessToken, refreshToken, instanceUrl, sfdcOrgId) so it can subsequently
 * call APIs that require either Bearer auth (lr_*) or org-scoped lookups.
 */
export function completeCliAuthSession(
  sessionId: string,
  payload: {
    accessToken: string;
    refreshToken?: string;
    instanceUrl: string;
    sfdcOrgId?: string;
  }
): boolean {
  const entry = store.get(sessionId);
  if (!entry || entry.expiresAt < Date.now()) {
    store.delete(sessionId);
    return false;
  }
  store.set(sessionId, {
    ...entry,
    status: "ok",
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    instanceUrl: payload.instanceUrl,
    sfdcOrgId: payload.sfdcOrgId,
  });
  return true;
}

export function pollCliAuthSession(sessionId: string): CliAuthEntry | null {
  const entry = store.get(sessionId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(sessionId);
    return null;
  }
  // Consume token on first successful poll
  if (entry.status === "ok") {
    store.delete(sessionId);
  }
  return entry;
}
