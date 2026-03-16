import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod output schema
// ---------------------------------------------------------------------------

export const aiLicenseResponseSchema = z.object({
  enhanced: z.object({
    prompt: z.string(),
    changes: z.array(z.string()),
  }),
  licensing: z.object({
    strategy: z.enum(["all", "named", "role", "department"]),
    userNames: z.array(z.string()),
    roleFilter: z.string().nullable(),
    departmentFilter: z.string().nullable(),
  }),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
});

export type AILicenseResponse = z.infer<typeof aiLicenseResponseSchema>;

// ---------------------------------------------------------------------------
// User type for matching
// ---------------------------------------------------------------------------

export interface AvailableUser {
  id: string;
  name: string;
  email: string;
  role: string | null;
  department: string | null;
  isLicensed: boolean;
}

// ---------------------------------------------------------------------------
// Resolved user after fuzzy matching
// ---------------------------------------------------------------------------

export interface ResolvedUser {
  aiName: string;
  matchedUserId: string | null;
  matchedUserName: string | null;
  matchedUserEmail: string | null;
  isAlreadyLicensed: boolean;
  confidence: "exact" | "fuzzy" | "unmatched";
}

// ---------------------------------------------------------------------------
// Few-shot examples
// ---------------------------------------------------------------------------

export const FEW_SHOT_EXAMPLES: { input: string; output: AILicenseResponse }[] =
  [
    {
      input: "License all my users",
      output: {
        enhanced: {
          prompt:
            "License all currently unlicensed users in the organization",
          changes: [
            "Interpreted 'all my users' as all unlicensed users",
            "Set strategy to 'all'",
            "Excluded already-licensed users from the list",
          ],
        },
        licensing: {
          strategy: "all",
          userNames: ["Alice Johnson", "Bob Smith", "Charlie Davis"],
          roleFilter: null,
          departmentFilter: null,
        },
        confidence: 0.95,
        warnings: [],
      },
    },
    {
      input: "License John and Sarah",
      output: {
        enhanced: {
          prompt:
            "License the specific users John and Sarah by name",
          changes: [
            "Matched 'John' to 'John Martinez' from the user list",
            "Matched 'Sarah' to 'Sarah Lee' from the user list",
            "Set strategy to 'named' for individual user selection",
          ],
        },
        licensing: {
          strategy: "named",
          userNames: ["John Martinez", "Sarah Lee"],
          roleFilter: null,
          departmentFilter: null,
        },
        confidence: 0.9,
        warnings: [],
      },
    },
    {
      input: "License everyone with Sales Rep role",
      output: {
        enhanced: {
          prompt:
            "License all unlicensed users whose role is 'Sales Rep'",
          changes: [
            "Matched users by role containing 'Sales Rep'",
            "Set strategy to 'role' with roleFilter 'Sales Rep'",
            "Excluded already-licensed users from the list",
          ],
        },
        licensing: {
          strategy: "role",
          userNames: ["Alice Johnson", "Charlie Davis"],
          roleFilter: "Sales Rep",
          departmentFilter: null,
        },
        confidence: 0.9,
        warnings: [
          "Matched 2 unlicensed users with role containing 'Sales Rep'. Verify the matched users are correct.",
        ],
      },
    },
    {
      input: "License the Marketing department",
      output: {
        enhanced: {
          prompt:
            "License all unlicensed users in the Marketing department",
          changes: [
            "Matched users by department 'Marketing'",
            "Set strategy to 'department' with departmentFilter 'Marketing'",
            "Excluded already-licensed users from the list",
          ],
        },
        licensing: {
          strategy: "department",
          userNames: ["Sarah Lee", "Tom Wilson"],
          roleFilter: null,
          departmentFilter: "Marketing",
        },
        confidence: 0.9,
        warnings: [
          "Matched 2 unlicensed users in the 'Marketing' department. Verify the matched users are correct.",
        ],
      },
    },
    {
      input: "License all users except admins",
      output: {
        enhanced: {
          prompt:
            "License all unlicensed users whose role is not 'Admin' or 'System Administrator'",
          changes: [
            "Interpreted 'except admins' as excluding users with admin-related roles",
            "Set strategy to 'named' with individually listed non-admin users",
            "Excluded already-licensed users from the list",
          ],
        },
        licensing: {
          strategy: "named",
          userNames: [
            "Alice Johnson",
            "Bob Smith",
            "Charlie Davis",
            "Sarah Lee",
          ],
          roleFilter: null,
          departmentFilter: null,
        },
        confidence: 0.85,
        warnings: [
          "Excluded users with admin-related roles. Verify no desired users were accidentally excluded.",
        ],
      },
    },
  ];

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

export function buildLicenseSystemPrompt(users: AvailableUser[]): string {
  const userList = users
    .map((u) => {
      const status = u.isLicensed ? "LICENSED" : "UNLICENSED";
      let desc = `- ${u.name} (${u.email}) [${status}]`;
      if (u.role) desc += `, role=${u.role}`;
      if (u.department) desc += `, department=${u.department}`;
      return desc;
    })
    .join("\n");

  const examplesText = FEW_SHOT_EXAMPLES.map(
    (ex, i) =>
      `Example ${i + 1}:\nUser: "${ex.input}"\nAssistant: ${JSON.stringify(ex.output, null, 2)}`,
  ).join("\n\n");

  return `You are an AI assistant that converts natural language descriptions into structured license assignment configurations for a lead routing system.

## Task
Given a user's description of who they want to license, produce a JSON object that defines:
1. The licensing strategy: "all", "named", "role", or "department"
2. The specific user names to license
3. An optional role or department filter
4. An enhanced version of the user's prompt
5. A confidence score
6. Any warnings about already-licensed users, ambiguity, or unmatched names

## Available Users
Below is the complete list of users in the organization, with their current license status.
${userList}

## Strategy Definitions
- **all**: License every currently unlicensed user. Include ALL unlicensed users in userNames.
- **named**: License specific users mentioned by name. Include only the named users in userNames.
- **role**: License all unlicensed users matching a role. Set roleFilter and include all matched unlicensed users in userNames.
- **department**: License all unlicensed users in a department. Set departmentFilter and include all matched unlicensed users in userNames.

## Important Rules
- **ONLY include UNLICENSED users in userNames.** Users already marked [LICENSED] should NOT appear in userNames.
- If a user mentions someone who is already licensed, add a warning like: "User 'X' is already licensed and was excluded."
- Use exact full names from the available users list when possible.
- If a name partially matches (e.g., "John" matches "John Martinez"), use the full name from the users list.
- For "all" strategy: include every UNLICENSED user in userNames. Do not leave it empty.
- For "role" strategy: set roleFilter to the matched role string. Include all UNLICENSED users with that role in userNames.
- For "department" strategy: set departmentFilter to the matched department string. Include all UNLICENSED users in that department in userNames.
- For exclusion patterns (e.g., "all except admins"): use "named" strategy and list individual non-excluded unlicensed users.
- Set roleFilter to null unless strategy is "role".
- Set departmentFilter to null unless strategy is "department".

## Output Format
Return ONLY a JSON object matching this exact structure (no markdown, no code fences):
{
  "enhanced": {
    "prompt": "A rewritten version of the user's prompt with explicit user names and configuration",
    "changes": ["List of interpretations or changes made"]
  },
  "licensing": {
    "strategy": "all" | "named" | "role" | "department",
    "userNames": ["Full User Name", "..."],
    "roleFilter": "Role Name" | null,
    "departmentFilter": "Department Name" | null
  },
  "confidence": 0.0 to 1.0,
  "warnings": ["optional array of warning strings"]
}

## Confidence Scoring
- 1.0: All users explicitly named and found, strategy is clear
- 0.8-0.9: Users found but some names were fuzzy-matched or role/department matching was used
- 0.6-0.7: Some ambiguity in user matching or intent
- 0.4-0.5: Significant guessing required; vague description
- Below 0.4: Too ambiguous to produce a reliable configuration

## Warning Guidelines
- Add a warning when a mentioned name does not match any available user
- Add a warning when matching by role/department to confirm the matched set
- Add a warning when a mentioned user is already licensed
- Add a warning when the request would result in zero new licenses

## Examples
${examplesText}

Now convert the user's prompt into the JSON structure described above.`;
}

// ---------------------------------------------------------------------------
// Fuzzy user resolution
// ---------------------------------------------------------------------------

export function resolveUsers(
  aiNames: string[],
  dbUsers: AvailableUser[],
): { resolved: ResolvedUser[]; warnings: string[] } {
  const warnings: string[] = [];
  const resolved: ResolvedUser[] = [];

  for (const aiName of aiNames) {
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
        isAlreadyLicensed: matched.isLicensed,
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
        isAlreadyLicensed: matched.isLicensed,
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
        isAlreadyLicensed: matched.isLicensed,
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
      isAlreadyLicensed: false,
      confidence: "unmatched",
    });
    warnings.push(
      `User "${aiName}" could not be matched to any available user.`,
    );
  }

  return { resolved, warnings };
}

// ---------------------------------------------------------------------------
// Response validator
// ---------------------------------------------------------------------------

export function validateLicenseResponse(
  response: unknown,
  users: AvailableUser[],
): {
  strategy: "all" | "named" | "role" | "department";
  users: ResolvedUser[];
  warnings: string[];
  confidence: number;
  newToLicense: number;
  alreadyLicensed: number;
} {
  // Step 1: Parse with Zod
  const parsed = aiLicenseResponseSchema.parse(response);

  // Step 2: Resolve user names
  const { resolved, warnings: resolveWarnings } = resolveUsers(
    parsed.licensing.userNames,
    users,
  );

  // Merge warnings
  const warnings = [...parsed.warnings, ...resolveWarnings];

  // Step 3: Count new vs already-licensed
  let newToLicense = 0;
  let alreadyLicensed = 0;

  for (const user of resolved) {
    if (user.confidence === "unmatched") continue;
    if (user.isAlreadyLicensed) {
      alreadyLicensed++;
      warnings.push(
        `User "${user.matchedUserName}" is already licensed.`,
      );
    } else {
      newToLicense++;
    }
  }

  if (newToLicense === 0 && resolved.length > 0) {
    warnings.push(
      "This request would result in zero new licenses — all matched users are already licensed.",
    );
  }

  return {
    strategy: parsed.licensing.strategy,
    users: resolved,
    warnings,
    confidence: parsed.confidence,
    newToLicense,
    alreadyLicensed,
  };
}
