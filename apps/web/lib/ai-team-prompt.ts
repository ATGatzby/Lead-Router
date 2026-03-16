import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod output schema
// ---------------------------------------------------------------------------

export const aiTeamMemberSchema = z.object({
  name: z.string(),
  weight: z.number().optional(),
});

export const aiTeamResponseSchema = z.object({
  enhanced: z.object({
    prompt: z.string(),
    changes: z.array(z.string()),
  }),
  team: z.object({
    name: z.string(),
    description: z.string().optional(),
    distributionType: z.enum(["round-robin", "weighted"]),
    members: z.array(aiTeamMemberSchema),
  }),
  weights: z
    .object({
      mode: z.enum(["percentage", "points"]),
      values: z.record(z.string(), z.number()),
    })
    .optional(),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()).optional(),
});

export type AITeamResponse = z.infer<typeof aiTeamResponseSchema>;

// ---------------------------------------------------------------------------
// User type for matching
// ---------------------------------------------------------------------------

export interface AvailableUser {
  id: string;
  name: string;
  email: string;
  role: string | null;
  department: string | null;
}

// ---------------------------------------------------------------------------
// Resolved member after fuzzy matching
// ---------------------------------------------------------------------------

export interface ResolvedMember {
  aiName: string;
  matchedUserId: string | null;
  matchedUserName: string | null;
  matchedUserEmail: string | null;
  weight: number;
  confidence: "exact" | "fuzzy" | "unmatched";
}

// ---------------------------------------------------------------------------
// Few-shot examples
// ---------------------------------------------------------------------------

export const FEW_SHOT_EXAMPLES: { input: string; output: AITeamResponse }[] = [
  {
    input: "Enterprise team with Alice, Bob, Charlie",
    output: {
      enhanced: {
        prompt:
          "Create a round-robin team called 'Enterprise' with members Alice, Bob, and Charlie, each with equal weight",
        changes: [
          "Named team 'Enterprise' from context",
          "Defaulted to round-robin distribution",
          "Assigned equal weight of 1 to each member",
        ],
      },
      team: {
        name: "Enterprise",
        distributionType: "round-robin",
        members: [
          { name: "Alice", weight: 1 },
          { name: "Bob", weight: 1 },
          { name: "Charlie", weight: 1 },
        ],
      },
      confidence: 0.95,
      warnings: [],
    },
  },
  {
    input: "SDR team with Alice 50%, Bob 30%, Charlie 20%",
    output: {
      enhanced: {
        prompt:
          "Create a weighted team called 'SDR' with Alice at 50%, Bob at 30%, and Charlie at 20%",
        changes: [
          "Named team 'SDR' from context",
          "Set distribution to weighted based on percentage values",
          "Using percentage mode for weights",
        ],
      },
      team: {
        name: "SDR",
        distributionType: "weighted",
        members: [
          { name: "Alice", weight: 50 },
          { name: "Bob", weight: 30 },
          { name: "Charlie", weight: 20 },
        ],
      },
      weights: {
        mode: "percentage",
        values: { Alice: 50, Bob: 30, Charlie: 20 },
      },
      confidence: 1.0,
      warnings: [],
    },
  },
  {
    input: "Create a team of all SDRs called Inbound",
    output: {
      enhanced: {
        prompt:
          "Create a round-robin team called 'Inbound' with all users whose role contains 'SDR'",
        changes: [
          "Named team 'Inbound' as specified",
          "Matched members by role containing 'SDR'",
          "Defaulted to round-robin distribution",
        ],
      },
      team: {
        name: "Inbound",
        distributionType: "round-robin",
        members: [],
      },
      confidence: 0.85,
      warnings: [
        "Members will be matched by role containing 'SDR'. Verify the matched users are correct.",
      ],
    },
  },
  {
    input:
      "West Coast reps for California leads, round robin with equal weights",
    output: {
      enhanced: {
        prompt:
          "Create a round-robin team called 'West Coast Reps' for handling California leads, with equal distribution",
        changes: [
          "Named team 'West Coast Reps' from context",
          "Added description about California leads",
          "Set round-robin distribution as specified",
        ],
      },
      team: {
        name: "West Coast Reps",
        description: "Handles California leads with equal round-robin distribution",
        distributionType: "round-robin",
        members: [],
      },
      confidence: 0.7,
      warnings: [
        "No specific members mentioned. You will need to add members manually or specify user names.",
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

export function buildTeamSystemPrompt(users: AvailableUser[]): string {
  const userList = users
    .map((u) => {
      let desc = `- ${u.name} (${u.email})`;
      if (u.role) desc += `, role=${u.role}`;
      if (u.department) desc += `, department=${u.department}`;
      return desc;
    })
    .join("\n");

  const examplesText = FEW_SHOT_EXAMPLES.map(
    (ex, i) =>
      `Example ${i + 1}:\nUser: "${ex.input}"\nAssistant: ${JSON.stringify(ex.output, null, 2)}`,
  ).join("\n\n");

  return `You are an AI assistant that converts natural language descriptions into structured team configurations for a lead routing system.

## Task
Given a user's description of a team they want to create, produce a JSON object that defines:
1. The team name
2. An optional description
3. The distribution type: "round-robin" (default) or "weighted"
4. The team members with their weights
5. An enhanced version of the user's prompt
6. A confidence score
7. Any warnings about ambiguity or unmatched members

## Available Users
All users listed below are already licensed and active. This is the complete set of assignable users.
${userList}

## Distribution Types
- **round-robin**: Equal distribution. Each member gets weight: 1.
- **weighted**: Unequal distribution. Weights can be specified as percentages (mode: "percentage") or points (mode: "points").

## Weight Rules
- For round-robin: always set weight to 1 for every member.
- For weighted: weights MUST be specified per member. If the user says percentages (e.g., "50%", "30%", "20%"), use mode "percentage". Otherwise use mode "points".
- If the user says "equal weights" or "equal distribution" with weighted type, set equal percentage weights (e.g., 3 members = 33.33 each, rounding to sum to 100).
- If the user says "equal" without specifying "weighted", default to round-robin.

## Member Matching Rules
- Match members by name from the available users list above.
- If the user says "all users", "all licensed users", "everyone", or "all available users", include EVERY user from the available users list as a member. All listed users are already licensed and active — no further filtering is needed.
- If the user says "all SDRs" or "all [role]", match ALL users whose role contains that term (case-insensitive). List each matched user as a member.
- If the user says "all [department]", match ALL users in that department. List each matched user as a member.
- Use exact names from the available users list when possible.
- If a name partially matches (e.g., "Alice" matches "Alice Johnson"), use the full name from the users list.

## Output Format
Return ONLY a JSON object matching this exact structure (no markdown, no code fences):
{
  "enhanced": {
    "prompt": "A rewritten version of the user's prompt using exact user names and explicit configuration",
    "changes": ["List of changes or interpretations made"]
  },
  "team": {
    "name": "Team Name",
    "description": "Optional description",
    "distributionType": "round-robin" | "weighted",
    "members": [
      { "name": "Full User Name", "weight": 1 }
    ]
  },
  "weights": {
    "mode": "percentage" | "points",
    "values": { "Full User Name": 50 }
  },
  "confidence": 0.0 to 1.0,
  "warnings": ["optional array of warning strings"]
}

Notes on the output:
- "weights" should only be included when distributionType is "weighted". Omit it for round-robin.
- "description" is optional — only include it if the user provides context about the team's purpose.
- In "members", always use the full name from the available users list if matched.
- If matching by role/department, include ALL matched users in the members array.

## Confidence Scoring
- 1.0: All members explicitly named and found in available users, distribution type clear
- 0.8-0.9: Members found but some names were fuzzy-matched or role-based matching was used
- 0.6-0.7: Some ambiguity in team name, description, or member matching
- 0.4-0.5: Significant guessing required; vague description
- Below 0.4: Too ambiguous to produce a reliable configuration

## Warning Guidelines
- Add a warning when a mentioned name does not match any available user
- Add a warning when matching by role/department to confirm the matched set
- Add a warning when no members are specified at all
- Add a warning when weight percentages don't sum to 100

## Examples
${examplesText}

Now convert the user's prompt into the JSON structure described above.`;
}

// ---------------------------------------------------------------------------
// Fuzzy member resolution
// ---------------------------------------------------------------------------

export function resolveMembers(
  aiMembers: { name: string; weight?: number }[],
  dbUsers: AvailableUser[],
): { resolved: ResolvedMember[]; warnings: string[] } {
  const warnings: string[] = [];
  const resolved: ResolvedMember[] = [];

  for (const member of aiMembers) {
    const aiName = member.name;
    const weight = member.weight ?? 1;
    const aiNameLower = aiName.toLowerCase();

    // 1. Exact match (case-insensitive full name)
    let matched = dbUsers.find(
      (u) => u.name.toLowerCase() === aiNameLower,
    );

    if (matched) {
      resolved.push({
        aiName,
        matchedUserId: matched.id,
        matchedUserName: matched.name,
        matchedUserEmail: matched.email,
        weight,
        confidence: "exact",
      });
      continue;
    }

    // 2. First name match
    matched = dbUsers.find((u) => {
      const firstName = u.name.split(" ")[0]?.toLowerCase();
      return firstName === aiNameLower;
    });

    if (matched) {
      resolved.push({
        aiName,
        matchedUserId: matched.id,
        matchedUserName: matched.name,
        matchedUserEmail: matched.email,
        weight,
        confidence: "fuzzy",
      });
      continue;
    }

    // 3. Contains match
    matched = dbUsers.find(
      (u) =>
        u.name.toLowerCase().includes(aiNameLower) ||
        aiNameLower.includes(u.name.toLowerCase()),
    );

    if (matched) {
      resolved.push({
        aiName,
        matchedUserId: matched.id,
        matchedUserName: matched.name,
        matchedUserEmail: matched.email,
        weight,
        confidence: "fuzzy",
      });
      continue;
    }

    // 4. No match
    resolved.push({
      aiName,
      matchedUserId: null,
      matchedUserName: null,
      matchedUserEmail: null,
      weight,
      confidence: "unmatched",
    });
    warnings.push(
      `Member "${aiName}" could not be matched to any available user.`,
    );
  }

  return { resolved, warnings };
}

// ---------------------------------------------------------------------------
// Response validator
// ---------------------------------------------------------------------------

export function validateTeamResponse(
  response: unknown,
  users: AvailableUser[],
): {
  team: {
    name: string;
    description: string | null;
    distributionType: "round-robin" | "weighted";
  };
  members: ResolvedMember[];
  weights: AITeamResponse["weights"] | null;
  warnings: string[];
  confidence: number;
} {
  // Step 1: Parse with Zod
  const parsed = aiTeamResponseSchema.parse(response);

  // Step 2: Resolve members
  const { resolved, warnings: resolveWarnings } = resolveMembers(
    parsed.team.members,
    users,
  );

  // Merge warnings
  const warnings = [...(parsed.warnings ?? []), ...resolveWarnings];

  // Step 3: Build weight map for matched members
  let weights = parsed.weights ?? null;
  if (parsed.team.distributionType === "weighted" && weights) {
    const updatedValues: Record<string, number> = {};
    for (const member of resolved) {
      if (member.matchedUserName) {
        updatedValues[member.matchedUserName] = member.weight;
      }
    }
    weights = { ...weights, values: updatedValues };
  }

  return {
    team: {
      name: parsed.team.name,
      description: parsed.team.description ?? null,
      distributionType: parsed.team.distributionType,
    },
    members: resolved,
    weights,
    warnings,
    confidence: parsed.confidence,
  };
}
