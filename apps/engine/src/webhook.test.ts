import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockFindUnique } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
}));

vi.mock("@lead-routing/db", () => ({
  prisma: {
    organization: {
      findUnique: mockFindUnique,
    },
  },
}));

import { fireWebhook, type WebhookPayload } from "./webhook.js";

const samplePayload: WebhookPayload = {
  event: "lead.routed",
  recordId: "00Q000000000001",
  objectType: "Lead",
  assigneeName: "Alice Smith",
  assigneeId: "005000000000001",
  ruleName: "Enterprise Leads",
  ruleId: "rule-1",
  timestamp: "2026-03-10T00:00:00Z",
};

let fetchSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, { status: 200 })
  );
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  fetchSpy.mockRestore();
  warnSpy.mockRestore();
});

// Helper: wait for the fire-and-forget promise to settle
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 50));
}

describe("fireWebhook", () => {
  it("fires a POST request when org has a webhookUrl configured", async () => {
    mockFindUnique.mockResolvedValue({
      notificationWebhookUrl: "https://hooks.example.com/route",
    });

    fireWebhook("org-1", samplePayload);
    await flush();

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://hooks.example.com/route",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(samplePayload),
      })
    );
  });

  it("skips fetch when webhookUrl is null", async () => {
    mockFindUnique.mockResolvedValue({ notificationWebhookUrl: null });

    fireWebhook("org-1", samplePayload);
    await flush();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips fetch when webhookUrl is empty string", async () => {
    mockFindUnique.mockResolvedValue({ notificationWebhookUrl: "" });

    fireWebhook("org-1", samplePayload);
    await flush();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips fetch when org is not found", async () => {
    mockFindUnique.mockResolvedValue(null);

    fireWebhook("org-1", samplePayload);
    await flush();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("logs a warning on non-OK response but does not throw", async () => {
    mockFindUnique.mockResolvedValue({
      notificationWebhookUrl: "https://hooks.example.com/route",
    });
    fetchSpy.mockResolvedValue(new Response(null, { status: 500 }));

    fireWebhook("org-1", samplePayload);
    await flush();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Non-2xx response 500")
    );
  });

  it("catches and logs fetch errors (never propagates)", async () => {
    mockFindUnique.mockResolvedValue({
      notificationWebhookUrl: "https://hooks.example.com/route",
    });
    fetchSpy.mockRejectedValue(new Error("network failure"));

    // Should NOT throw
    fireWebhook("org-1", samplePayload);
    await flush();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[webhook] Failed for org org-1"),
      expect.any(Error)
    );
  });

  it("sends the correct payload structure", async () => {
    mockFindUnique.mockResolvedValue({
      notificationWebhookUrl: "https://hooks.example.com/route",
    });

    fireWebhook("org-1", samplePayload);
    await flush();

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);

    expect(body).toEqual({
      event: "lead.routed",
      recordId: "00Q000000000001",
      objectType: "Lead",
      assigneeName: "Alice Smith",
      assigneeId: "005000000000001",
      ruleName: "Enterprise Leads",
      ruleId: "rule-1",
      timestamp: "2026-03-10T00:00:00Z",
    });
  });
});
