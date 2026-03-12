import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks (vi.mock is hoisted, so refs must also be hoisted) ────────

const { mockRedisStore, mockRedis, mockPrismaStore, mockPrisma } = vi.hoisted(() => {
  const mockRedisStore = new Map<string, Map<string, string>>();
  const mockRedis = {
    hget: vi.fn(async (hashKey: string, field: string) => {
      return mockRedisStore.get(hashKey)?.get(field) ?? null;
    }),
    hset: vi.fn(async (hashKey: string, field: string, value: string) => {
      let hash = mockRedisStore.get(hashKey);
      if (!hash) {
        hash = new Map();
        mockRedisStore.set(hashKey, hash);
      }
      hash.set(field, value);
      return 1;
    }),
    expire: vi.fn(async () => 1),
  };

  const mockPrismaStore: Array<{
    id: string;
    orgId: string;
    nameA: string;
    nameB: string;
    isSimilar: boolean;
    confidence: number | null;
    source: string;
    hitCount: number;
  }> = [];

  const mockPrisma = {
    companyAlias: {
      findUnique: vi.fn(async ({ where }: any) => {
        const { orgId, nameA, nameB } = where.orgId_nameA_nameB;
        return (
          mockPrismaStore.find(
            (r: any) => r.orgId === orgId && r.nameA === nameA && r.nameB === nameB
          ) ?? null
        );
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = mockPrismaStore.find((r: any) => r.id === where.id);
        if (row && data.hitCount?.increment) {
          row.hitCount += data.hitCount.increment;
        }
        return row;
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const { orgId, nameA, nameB } = where.orgId_nameA_nameB;
        const existing = mockPrismaStore.find(
          (r: any) => r.orgId === orgId && r.nameA === nameA && r.nameB === nameB
        );
        if (existing) {
          existing.isSimilar = update.isSimilar ?? existing.isSimilar;
          if (update.confidence !== undefined)
            existing.confidence = update.confidence;
          if (update.hitCount?.increment)
            existing.hitCount += update.hitCount.increment;
          return existing;
        }
        const newRow = {
          id: `cuid_${mockPrismaStore.length}`,
          ...create,
        };
        mockPrismaStore.push(newRow);
        return newRow;
      }),
    },
  };

  return { mockRedisStore, mockRedis, mockPrismaStore, mockPrisma };
});

vi.mock("../redis.js", () => ({
  getRedis: () => mockRedis,
}));

vi.mock("@lead-routing/db", () => ({
  prisma: mockPrisma,
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import {
  checkAliasCache,
  cacheAliasResult,
  cacheKey,
  _clearL1,
  _getL1Store,
} from "./alias-cache.js";

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  _clearL1();
  mockRedisStore.clear();
  mockPrismaStore.length = 0;
  vi.clearAllMocks();
});

// ─── cacheKey canonicalization ───────────────────────────────────────────────

describe("cacheKey", () => {
  it('normalizes case: "IBM"/"ibm" produce the same key', () => {
    expect(cacheKey("IBM", "ibm")).toBe(cacheKey("ibm", "IBM"));
  });

  it("A/B produces the same key as B/A", () => {
    expect(cacheKey("Apple Inc.", "Google LLC")).toBe(
      cacheKey("Google LLC", "Apple Inc.")
    );
  });

  it("sorts alphabetically after normalization", () => {
    const key = cacheKey("Zebra", "Acme");
    // "acme" < "zebra", so key should be "acme|zebra"
    expect(key).toBe("acme|zebra");
  });

  it("strips suffixes in the key", () => {
    expect(cacheKey("Apple Inc.", "Apple Corp.")).toBe("apple|apple");
  });
});

// ─── checkAliasCache ────────────────────────────────────────────────────────

describe("checkAliasCache", () => {
  it("returns null on cache miss (all layers empty)", async () => {
    const result = await checkAliasCache("org1", "Apple", "Google");
    expect(result).toBeNull();
  });

  it("returns cached value from L1 (in-memory)", async () => {
    // Prime L1 via cacheAliasResult
    await cacheAliasResult("org1", "Apple", "Google", true, 0.95);
    // Clear L2 and L3 to ensure L1 is the only source
    mockRedisStore.clear();
    mockPrismaStore.length = 0;

    const result = await checkAliasCache("org1", "Apple", "Google");
    expect(result).toBe(true);
    // Redis should NOT have been called (L1 hit short-circuits)
    expect(mockRedis.hget).not.toHaveBeenCalled();
  });

  it("L2 hit promotes to L1 and returns value", async () => {
    // Seed Redis L2 directly
    const key = cacheKey("Apple", "Google");
    const redisKey = "alias:org1";
    mockRedisStore.set(
      redisKey,
      new Map([[key, JSON.stringify({ isSimilar: false, ts: Date.now() })]])
    );

    const result = await checkAliasCache("org1", "Apple", "Google");
    expect(result).toBe(false);

    // Should now be in L1 — calling again should hit L1
    vi.clearAllMocks();
    const result2 = await checkAliasCache("org1", "Apple", "Google");
    expect(result2).toBe(false);
    expect(mockRedis.hget).not.toHaveBeenCalled();
  });

  it("L3 hit promotes to L1 and L2", async () => {
    // Seed Postgres L3 directly
    const key = cacheKey("Apple", "Google");
    const parts = key.split("|");
    mockPrismaStore.push({
      id: "alias_1",
      orgId: "org1",
      nameA: parts[0],
      nameB: parts[1],
      isSimilar: true,
      confidence: 0.88,
      source: "AI",
      hitCount: 5,
    });

    const result = await checkAliasCache("org1", "Apple", "Google");
    expect(result).toBe(true);

    // Should have promoted to L2 (Redis hset called)
    expect(mockRedis.hset).toHaveBeenCalled();

    // Should have incremented hitCount
    expect(mockPrisma.companyAlias.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "alias_1" },
        data: { hitCount: { increment: 1 } },
      })
    );

    // Should now be in L1 — calling again should hit L1
    vi.clearAllMocks();
    const result2 = await checkAliasCache("org1", "Apple", "Google");
    expect(result2).toBe(true);
    expect(mockRedis.hget).not.toHaveBeenCalled();
    expect(mockPrisma.companyAlias.findUnique).not.toHaveBeenCalled();
  });
});

// ─── cacheAliasResult ───────────────────────────────────────────────────────

describe("cacheAliasResult", () => {
  it("writes to all three layers", async () => {
    await cacheAliasResult("org1", "Acme", "Zebra", true, 0.92);

    // L1: should be populated
    const l1 = _getL1Store().get("org1");
    expect(l1).toBeDefined();
    const key = cacheKey("Acme", "Zebra");
    expect(l1!.has(key)).toBe(true);

    // L2: Redis hset called
    expect(mockRedis.hset).toHaveBeenCalledWith(
      "alias:org1",
      key,
      expect.any(String)
    );
    expect(mockRedis.expire).toHaveBeenCalledWith("alias:org1", 86400);

    // L3: Prisma upsert called
    expect(mockPrisma.companyAlias.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          orgId: "org1",
          isSimilar: true,
          confidence: 0.92,
          source: "AI",
          hitCount: 1,
        }),
        update: expect.objectContaining({
          isSimilar: true,
          confidence: 0.92,
          hitCount: { increment: 1 },
        }),
      })
    );
  });

  it("stores names in alphabetical order", async () => {
    await cacheAliasResult("org1", "Zebra", "Acme", true);

    // Prisma should receive nameA < nameB
    const call = mockPrisma.companyAlias.upsert.mock.calls[0][0];
    expect(call.create.nameA).toBe("acme");
    expect(call.create.nameB).toBe("zebra");
  });
});

// ─── LRU eviction ───────────────────────────────────────────────────────────

describe("LRU eviction", () => {
  it("evicts oldest entry when capacity (1000) is reached", async () => {
    const orgId = "org_eviction";

    // Fill up 1000 entries
    for (let i = 0; i < 1000; i++) {
      await cacheAliasResult(orgId, `CompanyA_${i}`, `CompanyB_${i}`, true);
    }

    const l1 = _getL1Store().get(orgId)!;
    expect(l1.size).toBe(1000);

    // The first key we inserted
    const firstKey = cacheKey("CompanyA_0", "CompanyB_0");
    expect(l1.has(firstKey)).toBe(true);

    // Add one more — should evict the first
    await cacheAliasResult(orgId, "NewCompanyA", "NewCompanyB", false);
    expect(l1.size).toBe(1000);
    expect(l1.has(firstKey)).toBe(false);

    const newKey = cacheKey("NewCompanyA", "NewCompanyB");
    expect(l1.has(newKey)).toBe(true);
  });
});
