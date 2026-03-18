/**
 * Tests for the flattenConditionGroups algorithm used in router.ts.
 *
 * The function is not exported from router.ts, so we replicate it here
 * to test the algorithm in isolation. Any changes to the function in
 * router.ts MUST be mirrored here to keep tests valid.
 */
import { describe, it, expect } from "vitest";

// ── Replicated from router.ts (not exported) ─────────────────────────────

function flattenConditionGroups(
  rawConditions: any[]
): Array<{
  groupId: string;
  fieldName: string;
  fieldType: string;
  operator: string;
  value: string | null;
}> {
  if (!Array.isArray(rawConditions) || rawConditions.length === 0) return [];
  return rawConditions.flatMap((g: any) => {
    if (Array.isArray(g?.conditions)) {
      // ConditionGroup format: { id, conjunction, conditions: [{fieldApiName, operator, value}] }
      return g.conditions.map((c: any) => ({
        groupId: g.id ?? g.groupId ?? "default",
        fieldName: c.fieldApiName ?? c.fieldName,
        fieldType: c.fieldType ?? "TEXT",
        operator: c.operator,
        value: c.value ?? null,
      }));
    }
    // Flat condition format: { groupId, fieldName, operator, value }
    if (g.fieldName || g.fieldApiName) {
      return [
        {
          groupId: g.groupId ?? "default",
          fieldName: g.fieldName ?? g.fieldApiName,
          fieldType: g.fieldType ?? "TEXT",
          operator: g.operator,
          value: g.value ?? null,
        },
      ];
    }
    return [];
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("flattenConditionGroups", () => {
  it("handles ConditionGroup[] format (with fieldApiName)", () => {
    const groups = [
      {
        id: "group-1",
        conjunction: "AND",
        conditions: [
          { fieldApiName: "Industry", fieldType: "TEXT", operator: "equals", value: "Tech" },
          { fieldApiName: "AnnualRevenue", fieldType: "NUMBER", operator: "gt", value: "1000000" },
        ],
      },
    ];

    const flat = flattenConditionGroups(groups);
    expect(flat).toHaveLength(2);
    expect(flat[0]).toEqual({
      groupId: "group-1",
      fieldName: "Industry",
      fieldType: "TEXT",
      operator: "equals",
      value: "Tech",
    });
    expect(flat[1]).toEqual({
      groupId: "group-1",
      fieldName: "AnnualRevenue",
      fieldType: "NUMBER",
      operator: "gt",
      value: "1000000",
    });
  });

  it("handles flat condition format (with fieldName)", () => {
    const flat = [
      { groupId: "g1", fieldName: "Status", fieldType: "PICKLIST", operator: "equals", value: "Active" },
      { groupId: "g1", fieldName: "Region", fieldType: "TEXT", operator: "equals", value: "US" },
    ];

    const result = flattenConditionGroups(flat);
    expect(result).toHaveLength(2);
    expect(result[0].fieldName).toBe("Status");
    expect(result[0].fieldType).toBe("PICKLIST");
    expect(result[1].fieldName).toBe("Region");
  });

  it("empty array returns empty", () => {
    expect(flattenConditionGroups([])).toEqual([]);
  });

  it("null/undefined input returns empty", () => {
    expect(flattenConditionGroups(null as any)).toEqual([]);
    expect(flattenConditionGroups(undefined as any)).toEqual([]);
  });

  it("maps fieldApiName to fieldName correctly (ConditionGroup format)", () => {
    const groups = [
      {
        id: "g1",
        conjunction: "AND",
        conditions: [
          { fieldApiName: "Custom_Field__c", operator: "contains", value: "test" },
        ],
      },
    ];

    const result = flattenConditionGroups(groups);
    expect(result[0].fieldName).toBe("Custom_Field__c");
    // Should NOT have fieldApiName in output
    expect((result[0] as any).fieldApiName).toBeUndefined();
  });

  it("maps fieldApiName to fieldName in flat format", () => {
    const flat = [
      { fieldApiName: "Custom__c", operator: "equals", value: "test" },
    ];

    const result = flattenConditionGroups(flat);
    expect(result[0].fieldName).toBe("Custom__c");
  });

  it("defaults fieldType to TEXT when missing", () => {
    const groups = [
      {
        id: "g1",
        conditions: [
          { fieldApiName: "Industry", operator: "equals", value: "Tech" },
        ],
      },
    ];

    const result = flattenConditionGroups(groups);
    expect(result[0].fieldType).toBe("TEXT");
  });

  it("defaults value to null when missing", () => {
    const groups = [
      {
        id: "g1",
        conditions: [
          { fieldApiName: "Industry", fieldType: "TEXT", operator: "is_blank" },
        ],
      },
    ];

    const result = flattenConditionGroups(groups);
    expect(result[0].value).toBeNull();
  });

  it("defaults groupId to 'default' when missing in ConditionGroup", () => {
    const groups = [
      {
        // No id or groupId
        conditions: [
          { fieldApiName: "X", operator: "equals", value: "1" },
        ],
      },
    ];

    const result = flattenConditionGroups(groups);
    expect(result[0].groupId).toBe("default");
  });

  it("defaults groupId to 'default' when missing in flat format", () => {
    const flat = [
      { fieldName: "X", operator: "equals", value: "1" },
    ];

    const result = flattenConditionGroups(flat);
    expect(result[0].groupId).toBe("default");
  });

  it("handles multiple groups correctly", () => {
    const groups = [
      {
        id: "g1",
        conjunction: "AND",
        conditions: [
          { fieldApiName: "A", operator: "equals", value: "1" },
        ],
      },
      {
        id: "g2",
        conjunction: "AND",
        conditions: [
          { fieldApiName: "B", operator: "equals", value: "2" },
          { fieldApiName: "C", operator: "equals", value: "3" },
        ],
      },
    ];

    const result = flattenConditionGroups(groups);
    expect(result).toHaveLength(3);
    expect(result[0].groupId).toBe("g1");
    expect(result[1].groupId).toBe("g2");
    expect(result[2].groupId).toBe("g2");
  });

  it("mixed formats work (some groups, some flat)", () => {
    const mixed = [
      {
        id: "g1",
        conditions: [
          { fieldApiName: "A", operator: "equals", value: "1" },
        ],
      },
      { fieldName: "B", groupId: "g2", operator: "gt", value: "100" },
    ];

    const result = flattenConditionGroups(mixed);
    expect(result).toHaveLength(2);
    expect(result[0].fieldName).toBe("A");
    expect(result[0].groupId).toBe("g1");
    expect(result[1].fieldName).toBe("B");
    expect(result[1].groupId).toBe("g2");
  });

  it("skips entries with no fieldName or fieldApiName", () => {
    const garbage = [
      { operator: "equals", value: "orphan" }, // no field name
      { id: "g1" }, // no conditions array, no field name
    ];

    const result = flattenConditionGroups(garbage);
    expect(result).toEqual([]);
  });

  it("uses groupId from ConditionGroup when id is missing but groupId is present", () => {
    const groups = [
      {
        groupId: "fallback-gid",
        conditions: [
          { fieldApiName: "X", operator: "equals", value: "1" },
        ],
      },
    ];

    const result = flattenConditionGroups(groups);
    expect(result[0].groupId).toBe("fallback-gid");
  });

  it("prefers fieldName over fieldApiName in flat format when both present", () => {
    // In flat format, g.fieldName is checked first
    const flat = [
      { fieldName: "primary", fieldApiName: "fallback", operator: "equals", value: "1" },
    ];

    const result = flattenConditionGroups(flat);
    expect(result[0].fieldName).toBe("primary");
  });
});
