import { z } from "zod";
import type { FieldSchema } from "@/components/condition-builder/types";

// ---------------------------------------------------------------------------
// Zod output schema
// ---------------------------------------------------------------------------

export const conditionSchema = z.object({
  fieldApiName: z.string(),
  fieldType: z.enum([
    "TEXT",
    "NUMBER",
    "DATE",
    "DATETIME",
    "BOOLEAN",
    "PICKLIST",
    "MULTI_PICKLIST",
    "LOOKUP",
  ]),
  operator: z.string(),
  value: z.string(),
});

export const conditionGroupSchema = z.object({
  conjunction: z.enum(["AND", "OR"]),
  conditions: z.array(conditionSchema),
});

export const aiTriggerResponseSchema = z.object({
  enhanced: z.object({
    prompt: z.string(),
    changes: z.array(z.string()),
  }),
  trigger: z.object({
    objectType: z.enum(["LEAD", "CONTACT", "ACCOUNT"]),
    triggerEvent: z.enum(["INSERT", "UPDATE", "BOTH"]),
    conditions: z.array(conditionGroupSchema),
  }),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()).optional(),
});

export type AITriggerResponse = z.infer<typeof aiTriggerResponseSchema>;

// ---------------------------------------------------------------------------
// Operator map
// ---------------------------------------------------------------------------

export const OPERATORS_BY_FIELD_TYPE: Record<string, string[]> = {
  TEXT: [
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "starts_with",
    "is_blank",
    "is_not_blank",
  ],
  NUMBER: [
    "equals",
    "not_equals",
    "gt",
    "lt",
    "gte",
    "lte",
    "is_blank",
    "is_not_blank",
  ],
  DATE: [
    "equals",
    "before",
    "after",
    "within_last",
    "is_blank",
    "is_not_blank",
  ],
  DATETIME: [
    "equals",
    "before",
    "after",
    "within_last",
    "is_blank",
    "is_not_blank",
  ],
  BOOLEAN: ["is_true", "is_false"],
  PICKLIST: [
    "equals",
    "not_equals",
    "includes",
    "excludes",
    "is_blank",
    "is_not_blank",
  ],
  MULTI_PICKLIST: ["includes", "excludes", "is_blank", "is_not_blank"],
  LOOKUP: ["equals", "not_equals", "is_blank", "is_not_blank"],
};

// ---------------------------------------------------------------------------
// Few-shot examples
// ---------------------------------------------------------------------------

export const FEW_SHOT_EXAMPLES: { input: string; output: AITriggerResponse }[] =
  [
    {
      input: "web leads",
      output: {
        enhanced: {
          prompt: "Route leads where LeadSource equals 'Web' on insert",
          changes: [
            "Mapped 'web leads' to LeadSource = 'Web'",
            "Defaulted trigger event to INSERT",
          ],
        },
        trigger: {
          objectType: "LEAD",
          triggerEvent: "INSERT",
          conditions: [
            {
              conjunction: "AND",
              conditions: [
                {
                  fieldApiName: "LeadSource",
                  fieldType: "PICKLIST",
                  operator: "equals",
                  value: "Web",
                },
              ],
            },
          ],
        },
        confidence: 1.0,
        warnings: [],
      },
    },
    {
      input:
        "enterprise leads from paid campaigns with more than 500 employees",
      output: {
        enhanced: {
          prompt:
            "Route leads where LeadSource equals 'Paid' AND NumberOfEmployees is greater than 500 on insert",
          changes: [
            "Mapped 'paid campaigns' to LeadSource = 'Paid'",
            "Mapped 'more than 500 employees' to NumberOfEmployees gt 500",
            "Mapped 'enterprise' to the employee count condition",
          ],
        },
        trigger: {
          objectType: "LEAD",
          triggerEvent: "INSERT",
          conditions: [
            {
              conjunction: "AND",
              conditions: [
                {
                  fieldApiName: "LeadSource",
                  fieldType: "PICKLIST",
                  operator: "equals",
                  value: "Paid",
                },
                {
                  fieldApiName: "NumberOfEmployees",
                  fieldType: "NUMBER",
                  operator: "gt",
                  value: "500",
                },
              ],
            },
          ],
        },
        confidence: 0.9,
        warnings: [],
      },
    },
    {
      input: "when lead status changes to qualified",
      output: {
        enhanced: {
          prompt:
            "Route leads where Status equals 'Qualified' on update",
          changes: [
            "Detected 'changes to' as an UPDATE trigger event",
            "Mapped 'status' to Status field",
            "Mapped 'qualified' to Status = 'Qualified'",
          ],
        },
        trigger: {
          objectType: "LEAD",
          triggerEvent: "UPDATE",
          conditions: [
            {
              conjunction: "AND",
              conditions: [
                {
                  fieldApiName: "Status",
                  fieldType: "PICKLIST",
                  operator: "equals",
                  value: "Qualified",
                },
              ],
            },
          ],
        },
        confidence: 1.0,
        warnings: [],
      },
    },
    {
      input: "leads from California or New York",
      output: {
        enhanced: {
          prompt:
            "Route leads where State includes 'California, New York' on insert",
          changes: [
            "Mapped 'California or New York' to State includes multiple values",
            "Used 'includes' operator with comma-separated values instead of separate conditions",
            "Defaulted trigger event to INSERT",
          ],
        },
        trigger: {
          objectType: "LEAD",
          triggerEvent: "INSERT",
          conditions: [
            {
              conjunction: "AND",
              conditions: [
                {
                  fieldApiName: "State",
                  fieldType: "TEXT",
                  operator: "includes",
                  value: "California,New York",
                },
              ],
            },
          ],
        },
        confidence: 1.0,
        warnings: [],
      },
    },
    {
      input: "leads NOT from partner channel",
      output: {
        enhanced: {
          prompt:
            "Route leads where LeadSource does not equal 'Partner' on insert",
          changes: [
            "Mapped 'NOT from partner channel' to LeadSource not_equals 'Partner'",
            "Defaulted trigger event to INSERT",
          ],
        },
        trigger: {
          objectType: "LEAD",
          triggerEvent: "INSERT",
          conditions: [
            {
              conjunction: "AND",
              conditions: [
                {
                  fieldApiName: "LeadSource",
                  fieldType: "PICKLIST",
                  operator: "not_equals",
                  value: "Partner",
                },
              ],
            },
          ],
        },
        confidence: 1.0,
        warnings: [],
      },
    },
    {
      input: "good leads",
      output: {
        enhanced: {
          prompt: "Route leads where Rating equals 'Hot' on insert",
          changes: [
            "Interpreted 'good leads' as Rating = 'Hot'",
            "Defaulted trigger event to INSERT",
          ],
        },
        trigger: {
          objectType: "LEAD",
          triggerEvent: "INSERT",
          conditions: [
            {
              conjunction: "AND",
              conditions: [
                {
                  fieldApiName: "Rating",
                  fieldType: "PICKLIST",
                  operator: "equals",
                  value: "Hot",
                },
              ],
            },
          ],
        },
        confidence: 0.5,
        warnings: [
          "Interpreted 'good leads' as Rating = 'Hot'. Please verify this matches your intent.",
        ],
      },
    },
    {
      input: "contacts at enterprise companies",
      output: {
        enhanced: {
          prompt:
            "Route contacts where Account.Type equals 'Enterprise' on insert",
          changes: [
            "Detected 'contacts' as CONTACT object type",
            "Mapped 'enterprise companies' to Account.Type = 'Enterprise'",
          ],
        },
        trigger: {
          objectType: "CONTACT",
          triggerEvent: "INSERT",
          conditions: [
            {
              conjunction: "AND",
              conditions: [
                {
                  fieldApiName: "Account.Type",
                  fieldType: "PICKLIST",
                  operator: "equals",
                  value: "Enterprise",
                },
              ],
            },
          ],
        },
        confidence: 0.7,
        warnings: [
          "Using relationship field Account.Type - ensure this field is available in your field sync.",
        ],
      },
    },
    {
      input: "leads that have been contacted",
      output: {
        enhanced: {
          prompt:
            "Route leads where HasBeenContacted is true on insert",
          changes: [
            "Mapped 'have been contacted' to HasBeenContacted = true",
            "Defaulted trigger event to INSERT",
          ],
        },
        trigger: {
          objectType: "LEAD",
          triggerEvent: "INSERT",
          conditions: [
            {
              conjunction: "AND",
              conditions: [
                {
                  fieldApiName: "HasBeenContacted",
                  fieldType: "BOOLEAN",
                  operator: "is_true",
                  value: "true",
                },
              ],
            },
          ],
        },
        confidence: 1.0,
        warnings: [],
      },
    },
  ];

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

export function buildTriggerSystemPrompt(fields: FieldSchema[]): string {
  const fieldList = fields
    .map((f) => {
      let desc = `- ${f.fieldApiName} (${f.fieldLabel}): type=${f.fieldType}`;
      if (
        f.picklistValues &&
        f.picklistValues.length > 0
      ) {
        desc += `, values=[${f.picklistValues.map((v) => `"${v}"`).join(", ")}]`;
      }
      return desc;
    })
    .join("\n");

  const operatorList = Object.entries(OPERATORS_BY_FIELD_TYPE)
    .map(([type, ops]) => `- ${type}: ${ops.join(", ")}`)
    .join("\n");

  const examplesText = FEW_SHOT_EXAMPLES.map(
    (ex, i) =>
      `Example ${i + 1}:\nUser: "${ex.input}"\nAssistant: ${JSON.stringify(ex.output, null, 2)}`,
  ).join("\n\n");

  return `You are an AI assistant that converts natural language descriptions into structured trigger configurations for a lead routing system.

## Task
Given a user's description of which records they want to route, produce a JSON object that defines:
1. The Salesforce object type (LEAD, CONTACT, or ACCOUNT)
2. The trigger event (INSERT, UPDATE, or BOTH)
3. One or more condition groups with field-level conditions
4. An enhanced version of the user's prompt using exact field names
5. A confidence score
6. Any warnings about ambiguity or missing fields

## Available Fields
${fieldList}

## Valid Operators by Field Type
${operatorList}

## Output Format
Return ONLY a JSON object matching this exact structure (no markdown, no code fences):
{
  "enhanced": {
    "prompt": "A rewritten version of the user's prompt using exact field API names and explicit operators",
    "changes": ["List of changes made to the original prompt"]
  },
  "trigger": {
    "objectType": "LEAD" | "CONTACT" | "ACCOUNT",
    "triggerEvent": "INSERT" | "UPDATE" | "BOTH",
    "conditions": [
      {
        "conjunction": "AND" | "OR",
        "conditions": [
          {
            "fieldApiName": "exact API name from the available fields list",
            "fieldType": "the field's type",
            "operator": "a valid operator for this field type",
            "value": "the condition value as a string"
          }
        ]
      }
    ]
  },
  "confidence": 0.0 to 1.0,
  "warnings": ["optional array of warning strings"]
}

## Prompt Enhancement Rules
- Rewrite the user's vague description into a precise statement using exact field API names
- In "changes", list every interpretation or assumption you made
- If the user says "web leads", rewrite to "leads where LeadSource equals 'Web'"
- If the user mentions a concept but not a field name, map it to the closest available field

## Confidence Scoring
- 1.0: Every term maps directly to an available field with exact match
- 0.8-0.9: All fields found but some values were inferred (e.g., "paid" -> "Paid Campaign")
- 0.6-0.7: Some fields were inferred from context rather than explicit mention
- 0.4-0.5: Significant guessing required; the prompt is vague
- Below 0.4: Too ambiguous to produce a reliable configuration

## Warning Guidelines
- Add a warning when a mentioned concept does not directly map to any available field
- Add a warning when you infer a field mapping that the user did not explicitly state
- Add a warning when a picklist value mentioned by the user does not match any known picklist values
- Add a warning when the prompt is ambiguous and could be interpreted multiple ways

## Default Behaviors
- If no object type is mentioned, default to LEAD
- If no trigger event is mentioned, default to INSERT
- If the user mentions "changes" or "updated", use UPDATE
- Use AND conjunction within a group unless the user explicitly says "or" about DIFFERENT fields
- IMPORTANT: When multiple values are listed for the SAME field (e.g., "State = FL, CA, MA" or "from California or New York"), use the "includes" operator with a single comma-separated value string (e.g., "FL,CA,MA"). Do NOT create separate condition rows for each value. The "includes" operator matches any of the comma-separated values.
- Similarly, for excluding multiple values on the same field, use "excludes" with comma-separated values
- IMPORTANT: "&", "and", "+", "also", "additionally" all mean AND — place these conditions in the SAME condition group with conjunction "AND". Only use separate condition groups (which are joined by OR) when the user explicitly says "or" about DIFFERENT conditions. A single AND group with multiple conditions is almost always what the user wants.

## Examples
${examplesText}

Now convert the user's prompt into the JSON structure described above.`;
}

// ---------------------------------------------------------------------------
// Response validator
// ---------------------------------------------------------------------------

export function validateAIResponse(
  response: unknown,
  availableFields: FieldSchema[],
): AITriggerResponse {
  // Step 1: Parse with Zod
  const parsed = aiTriggerResponseSchema.parse(response);

  // Build lookup maps
  const fieldsByApiName = new Map<string, FieldSchema>();
  for (const f of availableFields) {
    fieldsByApiName.set(f.fieldApiName.toLowerCase(), f);
  }

  const warnings: string[] = [...(parsed.warnings ?? [])];

  // Step 2: Validate each condition
  for (const group of parsed.trigger.conditions) {
    for (const condition of group.conditions) {
      const key = condition.fieldApiName.toLowerCase();
      const field = fieldsByApiName.get(key);

      if (!field) {
        // Check if it's a relationship field (e.g., Account.Type)
        const isRelationship = condition.fieldApiName.includes(".");
        if (isRelationship) {
          warnings.push(
            `Relationship field "${condition.fieldApiName}" cannot be validated against the available field list. Ensure it exists in your Salesforce org.`,
          );
        } else {
          warnings.push(
            `Field "${condition.fieldApiName}" was not found in the available fields. This condition may fail at runtime.`,
          );
        }
        continue;
      }

      // Validate field type matches
      if (field.fieldType !== condition.fieldType) {
        warnings.push(
          `Field "${condition.fieldApiName}" has type ${field.fieldType} but the condition uses ${condition.fieldType}. Correcting to ${field.fieldType}.`,
        );
        condition.fieldType = field.fieldType;
      }

      // Validate operator is valid for the field type
      const validOps = OPERATORS_BY_FIELD_TYPE[condition.fieldType];
      if (validOps && !validOps.includes(condition.operator)) {
        warnings.push(
          `Operator "${condition.operator}" is not valid for field type ${condition.fieldType} on field "${condition.fieldApiName}". Valid operators: ${validOps.join(", ")}.`,
        );
      }

      // Validate picklist values
      if (
        (field.fieldType === "PICKLIST" ||
          field.fieldType === "MULTI_PICKLIST") &&
        field.picklistValues &&
        field.picklistValues.length > 0
      ) {
        const val = condition.value;
        if (
          condition.operator !== "is_blank" &&
          condition.operator !== "is_not_blank" &&
          !field.picklistValues.includes(val)
        ) {
          // Case-insensitive check
          const match = field.picklistValues.find(
            (pv) => pv.toLowerCase() === val.toLowerCase(),
          );
          if (match) {
            warnings.push(
              `Picklist value "${val}" on "${condition.fieldApiName}" was corrected to "${match}" (case mismatch).`,
            );
            condition.value = match;
          } else {
            warnings.push(
              `Picklist value "${val}" is not in the known values for "${condition.fieldApiName}": [${field.picklistValues.join(", ")}].`,
            );
          }
        }
      }

      // Fix fieldApiName casing to match the actual field
      if (field.fieldApiName !== condition.fieldApiName) {
        condition.fieldApiName = field.fieldApiName;
      }
    }
  }

  // Merge warnings back
  return {
    ...parsed,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
