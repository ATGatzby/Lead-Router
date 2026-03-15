import { redis } from "./redis.js";

/**
 * Atomically advance the round-robin pointer and return the index of the next
 * team member to receive a lead.
 *
 * Uses a Lua script so INCR + modulo are performed in a single atomic
 * operation — even 500 concurrent routing events will each get a unique slot.
 */
const POINTER_SCRIPT = `
  local key   = KEYS[1]
  local count = tonumber(ARGV[1])
  if count == 0 then return -1 end
  local current = redis.call('INCR', key)
  return (current - 1) % count
`;

export interface TeamMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  assignmentCount: number;
}

/**
 * Returns the next active TeamMember for the given team, or null if the team
 * has no active members.
 *
 * @param orgId  - used to namespace the Redis key
 * @param teamId - the RoundRobinTeam.id
 * @param activeMembers - ordered list of ACTIVE members (sorted by createdAt ASC)
 */
export async function getNextMember(
  orgId: string,
  teamId: string,
  activeMembers: TeamMember[]
): Promise<TeamMember | null> {
  if (activeMembers.length === 0) return null;

  const key = `rr:${orgId}:${teamId}:pointer`;
  const index = await redis.eval(
    POINTER_SCRIPT,
    1,
    key,
    String(activeMembers.length)
  );

  if (index === -1) return null;
  return activeMembers[index as number];
}

/**
 * Reset the pointer to 0, so the next routing event starts from the first
 * active member.
 */
export async function resetPointer(orgId: string, teamId: string): Promise<void> {
  const key = `rr:${orgId}:${teamId}:pointer`;
  await redis.set(key, 0);
}

// ─── Weighted Round Robin ────────────────────────────────────────────────

export interface WeightedTeamMember extends TeamMember {
  weight: number;
}

/**
 * Compute the greatest common divisor of two numbers.
 */
function gcd(a: number, b: number): number {
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

/**
 * Compute GCD across an array of numbers.
 */
function gcdArray(nums: number[]): number {
  return nums.reduce((acc, n) => gcd(acc, n));
}

/**
 * Build an interleaved slot array that spreads members evenly rather than
 * clustering them.  For weights [2,2,1] → slots like [A,B,A,B,C] instead
 * of [A,A,B,B,C].
 */
function buildInterleavedSlots<T extends WeightedTeamMember>(members: T[]): T[] {
  const divisor = gcdArray(members.map((m) => m.weight));
  const normalized = members.map((m) => ({ member: m, slots: m.weight / divisor }));
  const totalSlots = normalized.reduce((sum, n) => sum + n.slots, 0);

  const result: T[] = new Array(totalSlots);
  // Track how many slots each member still needs
  const remaining = normalized.map((n) => n.slots);
  // Ideal spacing: for each member, ideal position = (totalSlots / memberSlots) * k
  for (let i = 0; i < totalSlots; i++) {
    // Pick the member with the highest "deficit" (remaining/total ratio vs filled so far)
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let j = 0; j < normalized.length; j++) {
      if (remaining[j] <= 0) continue;
      // Score: how overdue this member is for a slot
      const idealFraction = normalized[j].slots / totalSlots;
      const filledSoFar = normalized[j].slots - remaining[j];
      const score = idealFraction * (i + 1) - filledSoFar;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }
    result[i] = normalized[bestIdx].member;
    remaining[bestIdx]--;
  }

  return result;
}

/**
 * Returns the next active WeightedTeamMember using weighted round robin,
 * or null if the team has no active members.
 *
 * Weights are normalised by GCD to keep the virtual slot array compact,
 * and members are interleaved evenly across slots.
 *
 * Uses a SEPARATE Redis key (`wrr:`) from the equal round-robin (`rr:`).
 */
export async function getNextWeightedMember(
  orgId: string,
  teamId: string,
  activeMembers: WeightedTeamMember[]
): Promise<WeightedTeamMember | null> {
  if (activeMembers.length === 0) return null;

  const slots = buildInterleavedSlots(activeMembers);
  if (slots.length === 0) return null;

  const key = `wrr:${orgId}:${teamId}:pointer`;
  const index = await redis.eval(
    POINTER_SCRIPT,
    1,
    key,
    String(slots.length)
  );

  if (index === -1) return null;
  return slots[index as number];
}

/**
 * Reset the weighted round-robin pointer to 0.
 */
export async function resetWeightedPointer(orgId: string, teamId: string): Promise<void> {
  const key = `wrr:${orgId}:${teamId}:pointer`;
  await redis.set(key, 0);
}
