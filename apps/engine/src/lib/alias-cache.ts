/**
 * Three-layer alias cache for company similarity results.
 *
 * Layer 1: In-process LRU Map (1000 entries/org, 1h TTL, <0.01ms)
 * Layer 2: Redis hash `alias:{orgId}` (24h TTL, ~1ms)
 * Layer 3: Postgres `company_aliases` table (permanent, ~5ms)
 */

import { prisma } from "@lead-routing/db";
import { getRedis } from "../redis.js";
import { normalizeCompanyName } from "./fuzzy.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const L1_MAX_ENTRIES_PER_ORG = 1000;
const L1_TTL_MS = 60 * 60 * 1000; // 1 hour
const L2_TTL_SECONDS = 24 * 60 * 60; // 24 hours

// ─── Types ───────────────────────────────────────────────────────────────────

interface L1Entry {
  isSimilar: boolean;
  confidence?: number;
  ts: number; // Date.now() when cached
}

interface L2Value {
  isSimilar: boolean;
  confidence?: number;
  ts: number;
}

// ─── L1: In-memory LRU cache ────────────────────────────────────────────────

// Key: orgId → Map<canonicalKey, L1Entry>
const l1Store = new Map<string, Map<string, L1Entry>>();

function getL1Map(orgId: string): Map<string, L1Entry> {
  let map = l1Store.get(orgId);
  if (!map) {
    map = new Map();
    l1Store.set(orgId, map);
  }
  return map;
}

function l1Get(orgId: string, key: string): boolean | null {
  const map = l1Store.get(orgId);
  if (!map) return null;

  const entry = map.get(key);
  if (!entry) return null;

  // Check TTL
  if (Date.now() - entry.ts > L1_TTL_MS) {
    map.delete(key);
    return null;
  }

  return entry.isSimilar;
}

function l1Set(orgId: string, key: string, isSimilar: boolean, confidence?: number): void {
  const map = getL1Map(orgId);

  // LRU eviction: if at capacity and this is a new key, delete the oldest entry
  if (map.size >= L1_MAX_ENTRIES_PER_ORG && !map.has(key)) {
    // Map iteration order is insertion order — first key is the oldest
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) {
      map.delete(oldestKey);
    }
  }

  // Delete and re-insert to move to end (most recently used)
  map.delete(key);
  map.set(key, { isSimilar, confidence, ts: Date.now() });
}

// ─── Canonical cache key ────────────────────────────────────────────────────

/**
 * Build a canonical key from two company names.
 * Alphabetically sorts the normalized names and joins with "|".
 */
export function cacheKey(nameA: string, nameB: string): string {
  const a = normalizeCompanyName(nameA);
  const b = normalizeCompanyName(nameB);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Check all three cache layers for a company alias result.
 * Returns `true`/`false` if found (isSimilar), or `null` on cache miss.
 */
export async function checkAliasCache(
  orgId: string,
  nameA: string,
  nameB: string
): Promise<boolean | null> {
  const key = cacheKey(nameA, nameB);

  // Layer 1: In-memory LRU
  const l1Result = l1Get(orgId, key);
  if (l1Result !== null) {
    return l1Result;
  }

  // Layer 2: Redis
  try {
    const redis = getRedis();
    const redisKey = `alias:${orgId}`;
    const raw = await redis.hget(redisKey, key);

    if (raw !== null) {
      const parsed: L2Value = JSON.parse(raw);
      // Promote to L1
      l1Set(orgId, key, parsed.isSimilar, parsed.confidence);
      return parsed.isSimilar;
    }
  } catch (err) {
    console.error("[alias-cache] Redis L2 read error:", err);
  }

  // Layer 3: Postgres
  try {
    const [sortedA, sortedB] = sortedNames(nameA, nameB);
    const alias = await prisma.companyAlias.findUnique({
      where: {
        orgId_nameA_nameB: { orgId, nameA: sortedA, nameB: sortedB },
      },
    });

    if (alias) {
      // Promote to L1 + L2
      l1Set(orgId, key, alias.isSimilar, alias.confidence ?? undefined);
      await promoteToL2(orgId, key, alias.isSimilar, alias.confidence ?? undefined);

      // Increment hitCount
      await prisma.companyAlias.update({
        where: { id: alias.id },
        data: { hitCount: { increment: 1 } },
      });

      return alias.isSimilar;
    }
  } catch (err) {
    console.error("[alias-cache] Postgres L3 read error:", err);
  }

  return null;
}

/**
 * Write a company alias result to all three cache layers.
 */
export async function cacheAliasResult(
  orgId: string,
  nameA: string,
  nameB: string,
  isSimilar: boolean,
  confidence?: number
): Promise<void> {
  const key = cacheKey(nameA, nameB);
  const [sortedA, sortedB] = sortedNames(nameA, nameB);

  // Layer 1: In-memory
  l1Set(orgId, key, isSimilar, confidence);

  // Layer 2: Redis
  await promoteToL2(orgId, key, isSimilar, confidence);

  // Layer 3: Postgres upsert
  try {
    await prisma.companyAlias.upsert({
      where: {
        orgId_nameA_nameB: { orgId, nameA: sortedA, nameB: sortedB },
      },
      create: {
        orgId,
        nameA: sortedA,
        nameB: sortedB,
        isSimilar,
        confidence: confidence ?? null,
        source: "AI",
        hitCount: 1,
      },
      update: {
        isSimilar,
        confidence: confidence ?? undefined,
        hitCount: { increment: 1 },
      },
    });
  } catch (err) {
    console.error("[alias-cache] Postgres L3 write error:", err);
  }
}

// ─── Internal helpers ───────────────────────────────────────────────────────

/**
 * Return alphabetically sorted normalized names for Postgres storage.
 */
function sortedNames(nameA: string, nameB: string): [string, string] {
  const a = normalizeCompanyName(nameA);
  const b = normalizeCompanyName(nameB);
  return a < b ? [a, b] : [b, a];
}

/**
 * Write to Redis L2 cache.
 */
async function promoteToL2(
  orgId: string,
  key: string,
  isSimilar: boolean,
  confidence?: number
): Promise<void> {
  try {
    const redis = getRedis();
    const redisKey = `alias:${orgId}`;
    const value: L2Value = { isSimilar, confidence, ts: Date.now() };
    await redis.hset(redisKey, key, JSON.stringify(value));
    await redis.expire(redisKey, L2_TTL_SECONDS);
  } catch (err) {
    console.error("[alias-cache] Redis L2 write error:", err);
  }
}

// ─── Testing helpers ────────────────────────────────────────────────────────

/** Clear all L1 cache entries (used in tests). */
export function _clearL1(): void {
  l1Store.clear();
}

/** Expose L1 store for test inspection. */
export function _getL1Store(): Map<string, Map<string, L1Entry>> {
  return l1Store;
}
