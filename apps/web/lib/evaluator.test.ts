import { describe, it, expect, vi, afterEach } from "vitest";
import { evaluateRule, type EvalCondition } from "./evaluator";

function cond(
  fieldName: string,
  operator: string,
  value: string | null = null,
  groupId = "g1"
): EvalCondition {
  return { groupId, fieldName, operator, value };
}

describe("evaluator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("zero conditions (catch-all)", () => {
    it("matches when there are no conditions", () => {
      const result = evaluateRule({ Name: "Acme" }, []);
      expect(result.matched).toBe(true);
      expect(result.groups).toHaveLength(0);
    });
  });

  describe("is_blank / is_not_blank", () => {
    it("is_blank passes for null", () => {
      const result = evaluateRule({ f: null }, [cond("f", "is_blank")]);
      expect(result.matched).toBe(true);
    });

    it("is_blank passes for undefined (missing field)", () => {
      const result = evaluateRule({}, [cond("f", "is_blank")]);
      expect(result.matched).toBe(true);
    });

    it("is_blank passes for empty string", () => {
      const result = evaluateRule({ f: "" }, [cond("f", "is_blank")]);
      expect(result.matched).toBe(true);
    });

    it("is_blank fails for non-empty value", () => {
      const result = evaluateRule({ f: "hello" }, [cond("f", "is_blank")]);
      expect(result.matched).toBe(false);
    });

    it("is_not_blank passes for non-empty value", () => {
      const result = evaluateRule({ f: "hello" }, [cond("f", "is_not_blank")]);
      expect(result.matched).toBe(true);
    });

    it("is_not_blank fails for null", () => {
      const result = evaluateRule({ f: null }, [cond("f", "is_not_blank")]);
      expect(result.matched).toBe(false);
    });
  });

  describe("is_true / is_false", () => {
    it("is_true passes for boolean true", () => {
      const result = evaluateRule({ f: true }, [cond("f", "is_true")]);
      expect(result.matched).toBe(true);
    });

    it('is_true passes for string "true"', () => {
      const result = evaluateRule({ f: "true" }, [cond("f", "is_true")]);
      expect(result.matched).toBe(true);
    });

    it('is_true passes for string "True"', () => {
      const result = evaluateRule({ f: "True" }, [cond("f", "is_true")]);
      expect(result.matched).toBe(true);
    });

    it("is_true fails for false", () => {
      const result = evaluateRule({ f: false }, [cond("f", "is_true")]);
      expect(result.matched).toBe(false);
    });

    it("is_false passes for boolean false", () => {
      const result = evaluateRule({ f: false }, [cond("f", "is_false")]);
      expect(result.matched).toBe(true);
    });

    it('is_false passes for string "false"', () => {
      const result = evaluateRule({ f: "false" }, [cond("f", "is_false")]);
      expect(result.matched).toBe(true);
    });

    it('is_false passes for string "False"', () => {
      const result = evaluateRule({ f: "False" }, [cond("f", "is_false")]);
      expect(result.matched).toBe(true);
    });

    it("is_false passes for blank/null (treated as falsy)", () => {
      const result = evaluateRule({ f: null }, [cond("f", "is_false")]);
      expect(result.matched).toBe(true);
    });

    it("is_false fails for true", () => {
      const result = evaluateRule({ f: true }, [cond("f", "is_false")]);
      expect(result.matched).toBe(false);
    });
  });

  describe("equals / not_equals", () => {
    it("equals passes for matching strings", () => {
      const result = evaluateRule({ f: "hello" }, [cond("f", "equals", "hello")]);
      expect(result.matched).toBe(true);
    });

    it("equals fails for non-matching strings", () => {
      const result = evaluateRule({ f: "hello" }, [cond("f", "equals", "world")]);
      expect(result.matched).toBe(false);
    });

    it("not_equals passes for different values", () => {
      const result = evaluateRule({ f: "a" }, [cond("f", "not_equals", "b")]);
      expect(result.matched).toBe(true);
    });

    it("not_equals fails for same values", () => {
      const result = evaluateRule({ f: "a" }, [cond("f", "not_equals", "a")]);
      expect(result.matched).toBe(false);
    });
  });

  describe("contains / not_contains / starts_with", () => {
    it("contains passes (case-insensitive)", () => {
      const result = evaluateRule({ f: "Hello World" }, [
        cond("f", "contains", "WORLD"),
      ]);
      expect(result.matched).toBe(true);
    });

    it("contains fails when substring is absent", () => {
      const result = evaluateRule({ f: "Hello" }, [
        cond("f", "contains", "xyz"),
      ]);
      expect(result.matched).toBe(false);
    });

    it("not_contains passes when substring is absent", () => {
      const result = evaluateRule({ f: "Hello" }, [
        cond("f", "not_contains", "xyz"),
      ]);
      expect(result.matched).toBe(true);
    });

    it("not_contains fails when substring is present", () => {
      const result = evaluateRule({ f: "Hello World" }, [
        cond("f", "not_contains", "world"),
      ]);
      expect(result.matched).toBe(false);
    });

    it("starts_with passes (case-insensitive)", () => {
      const result = evaluateRule({ f: "Hello World" }, [
        cond("f", "starts_with", "hello"),
      ]);
      expect(result.matched).toBe(true);
    });

    it("starts_with fails when prefix does not match", () => {
      const result = evaluateRule({ f: "Hello" }, [
        cond("f", "starts_with", "World"),
      ]);
      expect(result.matched).toBe(false);
    });
  });

  describe("numeric operators (gt, lt, gte, lte)", () => {
    it("gt passes when field > value", () => {
      const result = evaluateRule({ f: 10 }, [cond("f", "gt", "5")]);
      expect(result.matched).toBe(true);
    });

    it("gt fails when field <= value", () => {
      const result = evaluateRule({ f: 5 }, [cond("f", "gt", "5")]);
      expect(result.matched).toBe(false);
    });

    it("lt passes when field < value", () => {
      const result = evaluateRule({ f: 3 }, [cond("f", "lt", "5")]);
      expect(result.matched).toBe(true);
    });

    it("lt fails when field >= value", () => {
      const result = evaluateRule({ f: 5 }, [cond("f", "lt", "5")]);
      expect(result.matched).toBe(false);
    });

    it("gte passes when field >= value", () => {
      const result = evaluateRule({ f: 5 }, [cond("f", "gte", "5")]);
      expect(result.matched).toBe(true);
    });

    it("lte passes when field <= value", () => {
      const result = evaluateRule({ f: 5 }, [cond("f", "lte", "5")]);
      expect(result.matched).toBe(true);
    });
  });

  describe("date operators (before, after, within_last)", () => {
    it("before passes when date is earlier", () => {
      const result = evaluateRule({ f: "2024-01-01" }, [
        cond("f", "before", "2025-01-01"),
      ]);
      expect(result.matched).toBe(true);
    });

    it("before fails when date is later", () => {
      const result = evaluateRule({ f: "2025-06-01" }, [
        cond("f", "before", "2025-01-01"),
      ]);
      expect(result.matched).toBe(false);
    });

    it("after passes when date is later", () => {
      const result = evaluateRule({ f: "2025-06-01" }, [
        cond("f", "after", "2025-01-01"),
      ]);
      expect(result.matched).toBe(true);
    });

    it("after fails when date is earlier", () => {
      const result = evaluateRule({ f: "2024-01-01" }, [
        cond("f", "after", "2025-01-01"),
      ]);
      expect(result.matched).toBe(false);
    });

    it("within_last passes for recent date", () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const result = evaluateRule(
        { f: yesterday.toISOString() },
        [cond("f", "within_last", "7")]
      );
      expect(result.matched).toBe(true);
    });

    it("within_last fails for old date", () => {
      const result = evaluateRule({ f: "2020-01-01" }, [
        cond("f", "within_last", "7"),
      ]);
      expect(result.matched).toBe(false);
    });
  });

  describe("multi-value operators (includes, excludes)", () => {
    it("includes passes when all check values are in raw", () => {
      const result = evaluateRule({ f: "A;B;C" }, [
        cond("f", "includes", "A;B"),
      ]);
      expect(result.matched).toBe(true);
    });

    it("includes fails when a check value is missing", () => {
      const result = evaluateRule({ f: "A;B" }, [
        cond("f", "includes", "A;C"),
      ]);
      expect(result.matched).toBe(false);
    });

    it("excludes passes when no check values are in raw", () => {
      const result = evaluateRule({ f: "A;B" }, [
        cond("f", "excludes", "C;D"),
      ]);
      expect(result.matched).toBe(true);
    });

    it("excludes fails when a check value is present", () => {
      const result = evaluateRule({ f: "A;B;C" }, [
        cond("f", "excludes", "C;D"),
      ]);
      expect(result.matched).toBe(false);
    });
  });

  describe("unknown operator", () => {
    it("fails with reason for unknown operator", () => {
      const result = evaluateRule({ f: "x" }, [cond("f", "banana", "x")]);
      expect(result.matched).toBe(false);
      expect(result.groups[0].conditions[0].reason).toContain(
        "Unknown operator"
      );
    });
  });

  describe("group AND/OR logic", () => {
    it("AND within a group: all conditions must pass", () => {
      const result = evaluateRule({ a: "x", b: "y" }, [
        cond("a", "equals", "x", "g1"),
        cond("b", "equals", "y", "g1"),
      ]);
      expect(result.matched).toBe(true);
    });

    it("AND within a group: one failure = group fails", () => {
      const result = evaluateRule({ a: "x", b: "WRONG" }, [
        cond("a", "equals", "x", "g1"),
        cond("b", "equals", "y", "g1"),
      ]);
      expect(result.matched).toBe(false);
    });

    it("OR between groups: one passing group = overall match", () => {
      const result = evaluateRule({ a: "x" }, [
        cond("a", "equals", "WRONG", "g1"),
        cond("a", "equals", "x", "g2"),
      ]);
      expect(result.matched).toBe(true);
    });

    it("OR between groups: all groups failing = no match", () => {
      const result = evaluateRule({ a: "x" }, [
        cond("a", "equals", "WRONG1", "g1"),
        cond("a", "equals", "WRONG2", "g2"),
      ]);
      expect(result.matched).toBe(false);
    });

    it("evaluates ALL groups even when first matches (full diagnostic)", () => {
      const result = evaluateRule({ a: "x" }, [
        cond("a", "equals", "x", "g1"),
        cond("a", "equals", "WRONG", "g2"),
      ]);
      expect(result.matched).toBe(true);
      expect(result.groups).toHaveLength(2);
      expect(result.groups[0].passed).toBe(true);
      expect(result.groups[1].passed).toBe(false);
    });
  });
});
