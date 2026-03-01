interface CliAuthEntry {
  status: "pending" | "ok";
  accessToken?: string;
  instanceUrl?: string;
  expiresAt: number;
}

// Module-level in-memory store — suitable for single-process self-hosted deployment.
// TTL: 10 minutes. Consumed and deleted on first successful poll.
const store = new Map<string, CliAuthEntry>();

export function createCliAuthSession(sessionId: string): void {
  const now = Date.now();
  // Prune expired sessions
  for (const [k, v] of store) {
    if (v.expiresAt < now) store.delete(k);
  }
  store.set(sessionId, { status: "pending", expiresAt: now + 10 * 60 * 1000 });
}

export function completeCliAuthSession(
  sessionId: string,
  accessToken: string,
  instanceUrl: string
): boolean {
  const entry = store.get(sessionId);
  if (!entry || entry.expiresAt < Date.now()) {
    store.delete(sessionId);
    return false;
  }
  store.set(sessionId, { ...entry, status: "ok", accessToken, instanceUrl });
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
