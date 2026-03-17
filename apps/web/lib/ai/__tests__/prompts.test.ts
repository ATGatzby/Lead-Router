import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  organization: {
    findUniqueOrThrow: vi.fn(),
  },
  user: {
    count: vi.fn(),
  },
  roundRobinTeam: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  routingRule: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  aiCustomPrompt: {
    findMany: vi.fn(),
  },
}));

vi.mock("@lead-routing/db", () => ({
  prisma: mockPrisma,
}));

import { composeSystemPrompt } from "../prompts";
import type { AgentContext } from "../contexts";

const ORG_ID = "org_test_123";

beforeEach(() => {
  vi.clearAllMocks();
  // Default mocks that prevent errors during getContextData calls
  mockPrisma.organization.findUniqueOrThrow.mockResolvedValue({
    seatsPurchased: 50,
    seatsUsed: 10,
  });
  mockPrisma.user.count.mockResolvedValue(20);
  mockPrisma.roundRobinTeam.findMany.mockResolvedValue([]);
  mockPrisma.roundRobinTeam.count.mockResolvedValue(0);
  mockPrisma.routingRule.findMany.mockResolvedValue([]);
  mockPrisma.routingRule.count.mockResolvedValue(0);
  mockPrisma.aiCustomPrompt.findMany.mockResolvedValue([]);
});

describe("composeSystemPrompt", () => {
  it("returns a string", async () => {
    const prompt = await composeSystemPrompt(ORG_ID, "global");
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("contains the base prompt text", async () => {
    const prompt = await composeSystemPrompt(ORG_ID, "global");
    expect(prompt).toContain("You are an AI assistant for Lead Router");
    expect(prompt).toContain("lead routing platform for Salesforce");
  });

  it("includes the mutation protocol section", async () => {
    const prompt = await composeSystemPrompt(ORG_ID, "global");
    expect(prompt).toContain("Mutation Protocol");
    expect(prompt).toContain("confirm=false");
    expect(prompt).toContain("confirm=true");
  });

  it("includes the confirmation UI section", async () => {
    const prompt = await composeSystemPrompt(ORG_ID, "global");
    expect(prompt).toContain("Confirmation UI");
    expect(prompt).toContain("confirmation");
  });

  describe("context-specific text", () => {
    it("license-users context includes licensing instructions", async () => {
      const prompt = await composeSystemPrompt(ORG_ID, "license-users");
      expect(prompt).toContain("user license management");
      expect(prompt).toContain("seat");
    });

    it("teams context includes team management instructions", async () => {
      const prompt = await composeSystemPrompt(ORG_ID, "teams");
      expect(prompt).toContain("round-robin team management");
    });

    it("routing-rules context includes rule instructions", async () => {
      const prompt = await composeSystemPrompt(ORG_ID, "routing-rules");
      expect(prompt).toContain("routing rule configuration");
      expect(prompt).toContain("SEARCH");
    });

    it("global context mentions ALL capabilities", async () => {
      const prompt = await composeSystemPrompt(ORG_ID, "global");
      expect(prompt).toContain("ALL capabilities");
    });
  });

  describe("context data injection", () => {
    it("license-users context includes seat usage stats", async () => {
      mockPrisma.organization.findUniqueOrThrow.mockResolvedValue({
        seatsPurchased: 50,
        seatsUsed: 10,
      });
      mockPrisma.user.count
        .mockResolvedValueOnce(30) // total active users
        .mockResolvedValueOnce(10); // licensed count

      const prompt = await composeSystemPrompt(ORG_ID, "license-users");
      expect(prompt).toContain("10/50 seats used");
    });

    it("teams context shows existing teams", async () => {
      mockPrisma.roundRobinTeam.findMany.mockResolvedValue([
        { id: "t1", name: "Sales", distributionType: "round-robin", _count: { members: 5 } },
        { id: "t2", name: "Support", distributionType: "weighted", _count: { members: 3 } },
      ]);

      const prompt = await composeSystemPrompt(ORG_ID, "teams");
      expect(prompt).toContain("Sales");
      expect(prompt).toContain("Support");
    });

    it("teams context reports when no teams exist", async () => {
      mockPrisma.roundRobinTeam.findMany.mockResolvedValue([]);

      const prompt = await composeSystemPrompt(ORG_ID, "teams");
      expect(prompt).toContain("No teams exist yet");
    });

    it("routing-rules context shows existing rules", async () => {
      mockPrisma.routingRule.findMany.mockResolvedValue([
        { id: "r1", name: "Enterprise", status: "ACTIVE", objectType: "LEAD", triggerEvent: "INSERT" },
      ]);

      const prompt = await composeSystemPrompt(ORG_ID, "routing-rules");
      expect(prompt).toContain("Enterprise");
      expect(prompt).toContain("ACTIVE");
    });

    it("global context shows org snapshot", async () => {
      mockPrisma.organization.findUniqueOrThrow.mockResolvedValue({
        seatsPurchased: 100,
        seatsUsed: 25,
      });
      mockPrisma.routingRule.count.mockResolvedValue(5);
      mockPrisma.roundRobinTeam.count.mockResolvedValue(3);
      mockPrisma.user.count.mockResolvedValue(42);

      const prompt = await composeSystemPrompt(ORG_ID, "global");
      expect(prompt).toContain("25/100 seats");
      expect(prompt).toContain("5 rules");
      expect(prompt).toContain("3 teams");
      expect(prompt).toContain("42 users");
    });
  });

  describe("custom instructions", () => {
    it("appends custom instruction prompts from the database", async () => {
      mockPrisma.aiCustomPrompt.findMany.mockResolvedValue([
        { type: "instruction", name: null, content: "Always mention SLA times", sortOrder: 1, context: null, isActive: true },
      ]);

      const prompt = await composeSystemPrompt(ORG_ID, "global");
      expect(prompt).toContain("CUSTOM INSTRUCTIONS");
      expect(prompt).toContain("Always mention SLA times");
    });

    it("appends vocabulary aliases", async () => {
      mockPrisma.aiCustomPrompt.findMany.mockResolvedValue([
        { type: "alias", name: "SDR", content: "Sales Development Representative", sortOrder: 1, context: null, isActive: true },
      ]);

      const prompt = await composeSystemPrompt(ORG_ID, "global");
      expect(prompt).toContain("VOCABULARY");
      expect(prompt).toContain('"SDR" means: Sales Development Representative');
    });

    it("appends recent agent action memories", async () => {
      mockPrisma.aiCustomPrompt.findMany.mockResolvedValue([
        { type: "memory", name: null, content: "Created team 'West Coast' with 5 members", sortOrder: 1, context: null, isActive: true },
      ]);

      const prompt = await composeSystemPrompt(ORG_ID, "global");
      expect(prompt).toContain("RECENT AGENT ACTIONS");
      expect(prompt).toContain("Created team 'West Coast' with 5 members");
    });

    it("does not add custom instructions section when no prompts exist", async () => {
      mockPrisma.aiCustomPrompt.findMany.mockResolvedValue([]);

      const prompt = await composeSystemPrompt(ORG_ID, "global");
      expect(prompt).not.toContain("CUSTOM INSTRUCTIONS");
    });
  });
});
