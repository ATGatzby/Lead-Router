import { describe, it, expect } from "vitest";
import { getOperatorsForType, NO_VALUE_OPERATORS } from "./operators";

describe("operators", () => {
  describe("getOperatorsForType", () => {
    it("returns TEXT operators for TEXT type", () => {
      const ops = getOperatorsForType("TEXT");
      const values = ops.map((o) => o.value);
      expect(values).toContain("equals");
      expect(values).toContain("not_equals");
      expect(values).toContain("contains");
      expect(values).toContain("not_contains");
      expect(values).toContain("starts_with");
      expect(values).toContain("is_blank");
      expect(values).toContain("is_not_blank");
    });

    it("returns NUMBER operators for NUMBER type", () => {
      const ops = getOperatorsForType("NUMBER");
      const values = ops.map((o) => o.value);
      expect(values).toContain("gt");
      expect(values).toContain("lt");
      expect(values).toContain("gte");
      expect(values).toContain("lte");
      expect(values).toContain("equals");
      expect(values).toContain("is_blank");
    });

    it("returns PICKLIST operators for PICKLIST type", () => {
      const ops = getOperatorsForType("PICKLIST");
      const values = ops.map((o) => o.value);
      expect(values).toContain("equals");
      expect(values).toContain("not_equals");
      expect(values).toContain("includes");
      expect(values).toContain("excludes");
    });

    it("returns MULTI_PICKLIST operators", () => {
      const ops = getOperatorsForType("MULTI_PICKLIST");
      const values = ops.map((o) => o.value);
      expect(values).toContain("includes");
      expect(values).toContain("excludes");
      expect(values).toHaveLength(2);
    });

    it("returns BOOLEAN operators", () => {
      const ops = getOperatorsForType("BOOLEAN");
      const values = ops.map((o) => o.value);
      expect(values).toEqual(["is_true", "is_false"]);
    });

    it("returns DATE operators", () => {
      const ops = getOperatorsForType("DATE");
      const values = ops.map((o) => o.value);
      expect(values).toContain("before");
      expect(values).toContain("after");
      expect(values).toContain("within_last");
      expect(values).toContain("is_blank");
    });

    it("returns DATETIME operators (same as DATE)", () => {
      const ops = getOperatorsForType("DATETIME");
      const values = ops.map((o) => o.value);
      expect(values).toContain("before");
      expect(values).toContain("after");
      expect(values).toContain("within_last");
    });

    it("returns LOOKUP operators", () => {
      const ops = getOperatorsForType("LOOKUP");
      const values = ops.map((o) => o.value);
      expect(values).toContain("equals");
      expect(values).toContain("not_equals");
      expect(values).toContain("is_blank");
      expect(values).toContain("is_not_blank");
    });

    it("falls back to TEXT operators for unknown field type", () => {
      const ops = getOperatorsForType("UNKNOWN_TYPE");
      const textOps = getOperatorsForType("TEXT");
      expect(ops).toEqual(textOps);
    });
  });

  describe("NO_VALUE_OPERATORS", () => {
    it("contains is_blank", () => {
      expect(NO_VALUE_OPERATORS.has("is_blank")).toBe(true);
    });

    it("contains is_not_blank", () => {
      expect(NO_VALUE_OPERATORS.has("is_not_blank")).toBe(true);
    });

    it("contains is_true", () => {
      expect(NO_VALUE_OPERATORS.has("is_true")).toBe(true);
    });

    it("contains is_false", () => {
      expect(NO_VALUE_OPERATORS.has("is_false")).toBe(true);
    });

    it("has exactly 4 members", () => {
      expect(NO_VALUE_OPERATORS.size).toBe(4);
    });

    it("does not contain equals", () => {
      expect(NO_VALUE_OPERATORS.has("equals")).toBe(false);
    });
  });
});
