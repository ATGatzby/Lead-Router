import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need fresh module state for each test since the store is module-level.
// Use dynamic imports + vi.resetModules() to get a clean store each time.
describe("cli-auth-store", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createCliAuthSession stores session and getCliAuthCodeVerifier returns verifier", async () => {
    const mod = await import("./cli-auth-store");
    mod.createCliAuthSession("sess-1", "verifier-abc");
    expect(mod.getCliAuthCodeVerifier("sess-1")).toBe("verifier-abc");
  });

  it("getCliAuthCodeVerifier returns undefined for unknown session", async () => {
    const mod = await import("./cli-auth-store");
    expect(mod.getCliAuthCodeVerifier("nonexistent")).toBeUndefined();
  });

  it("completeCliAuthSession marks session complete with tokens", async () => {
    const mod = await import("./cli-auth-store");
    mod.createCliAuthSession("sess-2", "verifier-xyz");

    const ok = mod.completeCliAuthSession(
      "sess-2",
      "access-token-123",
      "https://login.salesforce.com"
    );
    expect(ok).toBe(true);

    // Poll should return the completed session
    const entry = mod.pollCliAuthSession("sess-2");
    expect(entry).not.toBeNull();
    expect(entry!.status).toBe("ok");
    expect(entry!.accessToken).toBe("access-token-123");
    expect(entry!.instanceUrl).toBe("https://login.salesforce.com");
  });

  it("completeCliAuthSession returns false for unknown session", async () => {
    const mod = await import("./cli-auth-store");
    const ok = mod.completeCliAuthSession(
      "nonexistent",
      "tok",
      "https://login.salesforce.com"
    );
    expect(ok).toBe(false);
  });

  it("pollCliAuthSession returns and deletes completed session (consumed on first poll)", async () => {
    const mod = await import("./cli-auth-store");
    mod.createCliAuthSession("sess-3", "v");
    mod.completeCliAuthSession("sess-3", "tok", "https://sf.com");

    // First poll: returns the entry and deletes it
    const first = mod.pollCliAuthSession("sess-3");
    expect(first).not.toBeNull();
    expect(first!.status).toBe("ok");

    // Second poll: session should be gone
    const second = mod.pollCliAuthSession("sess-3");
    expect(second).toBeNull();
  });

  it("pollCliAuthSession returns pending entry without deleting it", async () => {
    const mod = await import("./cli-auth-store");
    mod.createCliAuthSession("sess-4", "v");

    // Poll a pending session: returns entry but does NOT delete
    const first = mod.pollCliAuthSession("sess-4");
    expect(first).not.toBeNull();
    expect(first!.status).toBe("pending");

    // Second poll: still there
    const second = mod.pollCliAuthSession("sess-4");
    expect(second).not.toBeNull();
    expect(second!.status).toBe("pending");
  });

  it("pollCliAuthSession returns null for unknown session", async () => {
    const mod = await import("./cli-auth-store");
    expect(mod.pollCliAuthSession("nonexistent")).toBeNull();
  });

  it("sessions expire after TTL", async () => {
    const mod = await import("./cli-auth-store");

    // Create a session
    mod.createCliAuthSession("sess-5", "v");

    // Advance time past the 10-minute TTL
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 11 * 60 * 1000);

    // Poll should return null (expired)
    expect(mod.pollCliAuthSession("sess-5")).toBeNull();
  });

  it("completeCliAuthSession returns false for expired session", async () => {
    const mod = await import("./cli-auth-store");
    mod.createCliAuthSession("sess-6", "v");

    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 11 * 60 * 1000);

    const ok = mod.completeCliAuthSession("sess-6", "tok", "https://sf.com");
    expect(ok).toBe(false);
  });

  it("createCliAuthSession prunes expired sessions", async () => {
    const mod = await import("./cli-auth-store");
    const baseTime = Date.now();

    // Create a session at base time
    mod.createCliAuthSession("old-sess", "v1");

    // Advance past TTL and create a new session — should prune old-sess
    vi.spyOn(Date, "now").mockReturnValue(baseTime + 11 * 60 * 1000);
    mod.createCliAuthSession("new-sess", "v2");

    // old-sess should be gone
    expect(mod.getCliAuthCodeVerifier("old-sess")).toBeUndefined();
    // new-sess should exist
    expect(mod.getCliAuthCodeVerifier("new-sess")).toBe("v2");
  });
});
