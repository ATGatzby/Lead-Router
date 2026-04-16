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

    it("CURRENCY returns same numeric operators as NUMBER", () => {
      const numberOps = getOperatorsForType("NUMBER");
      const currencyOps = getOperatorsForType("CURRENCY");
      expect(currencyOps).toEqual(numberOps);
    });

    it("DOUBLE returns same numeric operators as NUMBER", () => {
      const numberOps = getOperatorsForType("NUMBER");
      const doubleOps = getOperatorsForType("DOUBLE");
      expect(doubleOps).toEqual(numberOps);
    });

    it("PERCENT returns same numeric operators as NUMBER", () => {
      const numberOps = getOperatorsForType("NUMBER");
      const percentOps = getOperatorsForType("PERCENT");
      expect(percentOps).toEqual(numberOps);
    });

    it("INT returns same numeric operators as NUMBER", () => {
      const numberOps = getOperatorsForType("NUMBER");
      const intOps = getOperatorsForType("INT");
      expect(intOps).toEqual(numberOps);
    });

    it("all numeric types have gt, gte, lt, lte", () => {
      for (const type of ["NUMBER", "CURRENCY", "DOUBLE", "PERCENT", "INT"]) {
        const ops = getOperatorsForType(type).map((o) => o.value);
        expect(ops, `${type} should have gt`).toContain("gt");
        expect(ops, `${type} should have gte`).toContain("gte");
        expect(ops, `${type} should have lt`).toContain("lt");
        expect(ops, `${type} should have lte`).toContain("lte");
      }
    });

    it("TEXT includes all operators for MCP compatibility", () => {
      const ops = getOperatorsForType("TEXT").map((o) => o.value);
      // TEXT now includes numeric + multi-value operators because MCP tree converter
      // stores all conditions as fieldType TEXT — UI must render any operator Claude uses
      expect(ops).toContain("gt");
      expect(ops).toContain("gte");
      expect(ops).toContain("lt");
      expect(ops).toContain("lte");
      expect(ops).toContain("includes");
      expect(ops).toContain("excludes");
    });

    it("TEXT has fuzzy matching operators", () => {
      const ops = getOperatorsForType("TEXT").map((o) => o.value);
      expect(ops).toContain("fuzzy_equals");
      expect(ops).toContain("sounds_like");
      expect(ops).toContain("similar_to");
    });

    it("falls back to TEXT operators for unknown field type", () => {
      const ops = getOperatorsForType("UNKNOWN_TYPE");
      const textOps = getOperatorsForType("TEXT");
      expect(ops).toEqual(textOps);
    });

    it("falls back to TEXT operators for empty string type", () => {
      const ops = getOperatorsForType("");
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
