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
